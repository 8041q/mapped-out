/*
 * Local Map Content Manager
 *
 * This file intentionally does not modify the public map runtime. It reads/writes the
 * repository's existing data/catalog.js and images/<country>/ structure through the
 * local repository API exposed by app.py.
 */

'use strict';

const EXCEL_HEADERS = [
    'Country',
    'City',
    'Hospital Name',
    'Year',
    'Address',
    'Case Description',
    'Latitude',
    'Longitude',
];
const EXCEL_IMAGE_HEADER = 'Image';
const EMPTY_ROW_LIMIT = 5;
const PREFERRED_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_HIGH_QUALITY_START = 0.92;
const IMAGE_HIGH_QUALITY_MIN = 0.78;
const IMAGE_MIN_LONG_EDGE = 1600;
const OVERSIZED_IMAGE_BYTES = PREFERRED_MAX_IMAGE_BYTES;

// Human-facing region abbreviations live in region-metadata.js rather than application
// logic. SVGs can override them per region with data-code/data-abbr/data-label.
const REGION_CODE_OVERRIDES = window.MAPPED_OUT_REGION_CODES || {};

const state = {
    repositoryReady: false,
    repositoryName: '',
    apiToken: '',
    catalog: null,
    originalCatalogText: '',
    activeSlug: null,
    activeHotspotIndex: null,
    mapHotspotIndex: null,       // map-only focus; never changes the editor/list selection
    svgSources: new Map(),
    svgMeta: new Map(),
    stagedWrites: new Map(),       // repo-relative path -> Blob/File/string
    stagedDeletes: new Set(),      // repo-relative file paths
    tempStagedPaths: new Set(),   // optimized files persisted in the manager temp workspace
    objectUrls: new Map(),
    pendingImport: null,
    countryDialogMode: 'add',
    dirty: false,
    pendingCountrySwitch: null,
    previewBaseView: null,
    previewView: null,
    selectedHotspots: new Set(),
    importHistory: [],
    imageOptimizationMeta: new Map(),
    imageReducePath: null,
    fileStats: new Map(),
    deepValidationIssues: new Map(),
    metadataHydrationComplete: false,
};

const els = {};

const customSelectState = {
    activeSelect: null,
    popover: null,
};

window.addEventListener('DOMContentLoaded', () => {
    applyStoredFontSize();
    cacheElements();
    bindEvents();
    initializeCustomSelects();
    initializeRepository();
});

function cacheElements() {
    const ids = [
        'unsupported', 'help-button', 'help-dialog', 'reset-changes', 'validate-all', 'issues-indicator', 'issues-count', 'save-all', 'review-indicator', 'add-country',
        'country-list', 'workspace', 'workspace-empty', 'country-workspace', 'country-slug',
        'country-title', 'country-description', 'country-settings', 'replace-svg', 'import-excel', 'validate-country',
        'add-hotspot', 'country-health', 'import-history', 'hotspot-count', 'hotspot-search', 'hotspot-filter', 'hotspot-list',
        'bulk-toolbar', 'bulk-select-all', 'bulk-selected-count', 'bulk-province', 'bulk-apply-province',
        'bulk-validate', 'bulk-remove-images', 'bulk-delete', 'cleanup-unused-images',
        'editor-empty', 'hotspot-editor', 'hotspot-status-badge', 'delete-hotspot', 'field-title',
        'field-city', 'field-year', 'field-address', 'field-description', 'field-lat', 'field-lon',
        'field-province', 'field-xy', 'coordinate-message', 'apply-swap', 'image-picker',
        'image-dropzone', 'image-list', 'map-stage', 'map-preview', 'map-zoom-in', 'map-zoom-out', 'map-zoom-reset', 'map-label-mode', 'hotspot-hover-card', 'reset-position', 'svg-picker', 'excel-picker',
        'country-dialog', 'country-form', 'country-dialog-title', 'slug-field-wrap', 'map-country-name', 'map-slug',
        'map-title', 'map-description', 'map-logo', 'map-logo-alt', 'map-hue', 'map-sat',
        'map-min-light', 'map-max-light', 'map-color-picker', 'map-color-preview', 'new-svg-wrap', 'map-svg', 'country-form-message',
        'validation-dialog', 'validation-dialog-title', 'validation-summary', 'validation-filters', 'validation-scroll-region', 'validation-results', 'save-dialog',
        'save-validation-note', 'change-summary', 'confirm-save', 'unsaved-dialog', 'unsaved-stay', 'unsaved-discard', 'unsaved-save', 'delete-dialog', 'delete-message',
        'confirm-delete', 'import-dialog', 'import-summary', 'import-plan', 'import-warnings',
        'confirm-import', 'image-reduce-dialog', 'image-reduce-summary', 'lossless-choice', 'image-reduce-message', 'confirm-image-reduce', 'toast'
    ];
    ids.forEach(id => els[toCamel(id)] = document.getElementById(id));
}

function toCamel(id) {
    return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function enforceCountrySlugInput() {
    if (!els.mapSlug) return;
    const normalized = normalizeCountrySlug(els.mapSlug.value);
    if (els.mapSlug.value !== normalized) els.mapSlug.value = normalized;
}

function setIssuesButtonState(level, count, title) {
    if (!els.validateAll || !els.issuesIndicator || !els.issuesCount) return;
    els.issuesIndicator.className = `status-dot ${level || 'neutral'}`;
    els.issuesCount.textContent = String(count ?? '-');
    els.validateAll.title = title || 'Project issues';
}

function updateIssuesButton() {
    if (!state.repositoryReady || !state.catalog) return;
    if (!state.metadataHydrationComplete) {
        setIssuesButtonState('neutral', '…', 'Checking project issues…');
        return;
    }
    let errors = 0;
    let warnings = 0;
    Object.keys(state.catalog).forEach(slug => {
        // Count validation messages, not affected hotspots. While a country has not
        // been opened yet, ignore the transient “SVG has not been loaded” state.
        const issues = dedupeIssues([
            ...validateCountry(slug).filter(issue => issue.text !== 'SVG has not been loaded.'),
            ...(state.deepValidationIssues.get(slug) || []),
        ]);
        errors += issues.filter(issue => issue.level === 'error').length;
        warnings += issues.filter(issue => issue.level === 'warning').length;
    });
    const count = errors + warnings;
    const level = errors ? 'error' : warnings ? 'warning' : 'ok';
    const parts = [];
    if (errors) parts.push(`${errors} blocking`);
    if (warnings) parts.push(`${warnings} to review`);
    setIssuesButtonState(level, count, parts.length ? parts.join(' · ') : 'No known issues');
}

function bindEvents() {
    document.querySelectorAll('[data-font-size]').forEach(button => {
        button.addEventListener('click', () => setFontSize(button.dataset.fontSize));
    });
    els.addCountry.addEventListener('click', () => openCountryDialog('add'));
    els.helpButton.addEventListener('click', () => els.helpDialog.showModal());
    els.countrySettings.addEventListener('click', () => openCountryDialog('edit'));
    els.replaceSvg.addEventListener('click', () => els.svgPicker.click());
    els.importExcel.addEventListener('click', () => els.excelPicker.click());
    els.validateCountry.addEventListener('click', runCountryValidationDialog);
    els.addHotspot.addEventListener('click', addHotspot);
    els.hotspotSearch.addEventListener('input', renderHotspotList);
    els.hotspotFilter.addEventListener('change', renderHotspotList);
    els.bulkSelectAll.addEventListener('change', toggleSelectAllVisible);
    els.bulkApplyProvince.addEventListener('click', applyBulkProvince);
    els.bulkValidate.addEventListener('click', validateBulkSelection);
    els.bulkRemoveImages.addEventListener('click', removeImagesFromBulkSelection);
    els.bulkDelete.addEventListener('click', deleteBulkSelection);
    els.cleanupUnusedImages.addEventListener('click', cleanupUnusedImages);
    [els.countrySettings, els.replaceSvg, els.cleanupUnusedImages].forEach(button => {
        button.addEventListener('click', () => button.closest('details')?.removeAttribute('open'));
    });
    els.resetChanges.addEventListener('click', resetUnsavedChanges);
    els.validateAll.addEventListener('click', runValidationDialog);
    els.saveAll.addEventListener('click', prepareSaveDialog);
    els.confirmSave.addEventListener('click', saveToRepository);
    els.svgPicker.addEventListener('change', handleSvgReplacement);
    els.excelPicker.addEventListener('change', handleExcelSelected);
    els.countryForm.addEventListener('submit', handleCountryFormSubmit);
    els.deleteHotspot.addEventListener('click', openDeleteDialog);
    els.confirmDelete.addEventListener('click', confirmDeleteHotspot);
    els.confirmImport.addEventListener('click', confirmExcelImport);
    els.confirmImageReduce.addEventListener('click', confirmImageReduction);
    els.imagePicker.addEventListener('change', e => addImagesToSelected(Array.from(e.target.files || [])));
    els.resetPosition.addEventListener('click', resetSelectedHotspot);
    els.applySwap.addEventListener('click', applySuggestedSwap);
    ['mapHue', 'mapSat', 'mapMinLight', 'mapMaxLight'].forEach(key => {
        els[key].addEventListener('input', updateColorPreviewFromFields);
    });
    els.mapColorPicker.addEventListener('input', applyColorPickerToFields);
    bindRegionLabelMode();
    els.mapSlug.addEventListener('input', enforceCountrySlugInput);
    els.mapZoomIn.addEventListener('click', () => zoomPreview(0.72));
    els.mapZoomOut.addEventListener('click', () => zoomPreview(1.38));
    els.mapZoomReset.addEventListener('click', resetPreviewView);
    els.unsavedStay.addEventListener('click', () => { state.pendingCountrySwitch = null; els.unsavedDialog.close(); });
    els.unsavedDiscard.addEventListener('click', discardAndSwitchCountry);
    els.unsavedSave.addEventListener('click', () => { els.unsavedDialog.close(); prepareSaveDialog(); });
    els.saveDialog.addEventListener('close', () => {
        if (state.pendingCountrySwitch && state.dirty) state.pendingCountrySwitch = null;
    });
    ['fieldTitle', 'fieldCity', 'fieldYear', 'fieldAddress', 'fieldDescription'].forEach(key => {
        els[key].addEventListener('input', syncEditorTextFields);
    });
    els.fieldLat.addEventListener('change', syncCoordinateFields);
    els.fieldLon.addEventListener('change', syncCoordinateFields);
    els.fieldProvince.addEventListener('change', syncProvinceField);

    els.imageDropzone.addEventListener('dragover', event => {
        event.preventDefault();
        els.imageDropzone.classList.add('dragover');
    });
    els.imageDropzone.addEventListener('dragleave', () => els.imageDropzone.classList.remove('dragover'));
    els.imageDropzone.addEventListener('drop', event => {
        event.preventDefault();
        els.imageDropzone.classList.remove('dragover');
        addImagesToSelected(Array.from(event.dataTransfer.files || []).filter(f => f.type.startsWith('image/')));
    });

    document.querySelectorAll('[data-close-dialog]').forEach(button => {
        button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close());
    });
    document.addEventListener('click', event => {
        document.querySelectorAll('details.action-menu[open]').forEach(menu => {
            if (!menu.contains(event.target)) menu.removeAttribute('open');
        });
    });
}


function initializeCustomSelects(root = document) {
    root.querySelectorAll('select:not([data-custom-select])').forEach(enhanceCustomSelect);
    if (!customSelectState.popover) {
        const popover = document.createElement('div');
        popover.className = 'custom-select-popover hidden';
        popover.setAttribute('role', 'listbox');
        document.body.appendChild(popover);
        customSelectState.popover = popover;

        document.addEventListener('pointerdown', event => {
            const active = customSelectState.activeSelect;
            if (!active) return;
            const wrapper = active.closest('.custom-select');
            if (wrapper?.contains(event.target) || popover.contains(event.target)) return;
            closeCustomSelect();
        });
        // Keep an open menu attached to its field while the page or any ancestor scrolls.
        // Closing on `scroll` was unreliable because real wheel/trackpad scrolling can scroll
        // both the option list and a parent in the same gesture (scroll chaining).
        const repositionOpenSelect = () => {
            const active = customSelectState.activeSelect;
            if (!active || customSelectState.repositionQueued) return;
            customSelectState.repositionQueued = true;
            requestAnimationFrame(() => {
                customSelectState.repositionQueued = false;
                if (customSelectState.activeSelect === active) positionCustomSelectPopover(active);
            });
        };
        window.addEventListener('resize', repositionOpenSelect);
        window.addEventListener('scroll', repositionOpenSelect, true);
        popover.addEventListener('wheel', event => {
            // Never let a wheel gesture inside the menu be interpreted as an outside action.
            event.stopPropagation();
        }, { passive: true });
    }
}

function enhanceCustomSelect(select) {
    if (!select || select.dataset.customSelect) return;
    select.dataset.customSelect = 'true';
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    if (select.classList.contains('compact-select')) wrapper.classList.add('compact');
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    select.classList.add('native-select-hidden');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'custom-select-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span class="custom-select-label"></span><svg class="custom-select-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6 4.5 4 4.5-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    wrapper.appendChild(button);

    button.addEventListener('click', () => {
        if (select.disabled) return;
        if (customSelectState.activeSelect === select) closeCustomSelect();
        else openCustomSelect(select);
    });
    button.addEventListener('keydown', event => {
        if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            openCustomSelect(select);
        }
    });
    select.addEventListener('change', () => refreshCustomSelect(select));

    const observer = new MutationObserver(() => {
        refreshCustomSelect(select);
        if (customSelectState.activeSelect === select) renderCustomSelectPopover(select);
    });
    observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label'] });
    select._customSelectObserver = observer;
    refreshCustomSelect(select);
}

function refreshCustomSelect(select) {
    if (!select?.dataset.customSelect) return;
    const wrapper = select.closest('.custom-select');
    const button = wrapper?.querySelector('.custom-select-button');
    if (!button) return;
    const selected = select.options[select.selectedIndex];
    button.querySelector('.custom-select-label').textContent = selected?.textContent || 'Select…';
    button.disabled = select.disabled;
    button.setAttribute('aria-label', select.getAttribute('aria-label') || selected?.textContent || 'Select option');
}

function refreshAllCustomSelects() {
    document.querySelectorAll('select[data-custom-select]').forEach(refreshCustomSelect);
}

function openCustomSelect(select) {
    initializeCustomSelects();
    closeCustomSelect();
    customSelectState.activeSelect = select;
    const wrapper = select.closest('.custom-select');
    wrapper?.classList.add('open');
    wrapper?.querySelector('.custom-select-button')?.setAttribute('aria-expanded', 'true');
    renderCustomSelectPopover(select);
}

function renderCustomSelectPopover(select) {
    const popover = customSelectState.popover;
    const button = select.closest('.custom-select')?.querySelector('.custom-select-button');
    if (!popover || !button) return;
    popover.innerHTML = '';
    popover.classList.remove('hidden');

    const options = Array.from(select.options);
    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'custom-select-options';

    let search = null;
    if (options.length > 12) {
        const searchWrap = document.createElement('div');
        searchWrap.className = 'custom-select-search-wrap';
        search = document.createElement('input');
        search.type = 'search';
        search.className = 'custom-select-search';
        search.placeholder = 'Filter options…';
        search.setAttribute('aria-label', 'Filter dropdown options');
        searchWrap.appendChild(search);
        popover.appendChild(searchWrap);
    }
    popover.appendChild(optionsWrap);

    const paint = (query = '') => {
        const needle = query.trim().toLowerCase();
        optionsWrap.innerHTML = '';
        const shown = options.filter(option => !needle || option.textContent.toLowerCase().includes(needle));
        if (!shown.length) {
            const empty = document.createElement('div');
            empty.className = 'custom-select-empty';
            empty.textContent = 'No matching options';
            optionsWrap.appendChild(empty);
            return;
        }
        shown.forEach(option => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `custom-select-option${option.value === select.value ? ' selected' : ''}`;
            item.textContent = option.textContent;
            item.disabled = option.disabled;
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(option.value === select.value));
            item.addEventListener('click', () => {
                select.value = option.value;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
                refreshCustomSelect(select);
                closeCustomSelect();
                button.focus();
            });
            optionsWrap.appendChild(item);
        });
    };
    paint();
    if (search) {
        search.addEventListener('input', () => paint(search.value));
        requestAnimationFrame(() => search.focus());
    }

    positionCustomSelectPopover(select);
}

function positionCustomSelectPopover(select) {
    const popover = customSelectState.popover;
    const button = select?.closest('.custom-select')?.querySelector('.custom-select-button');
    if (!popover || !button || popover.classList.contains('hidden')) return;
    const options = Array.from(select.options);
    const rect = button.getBoundingClientRect();
    const desiredWidth = Math.max(rect.width, options.length > 12 ? 260 : 180);
    popover.style.width = `${Math.min(desiredWidth, window.innerWidth - 20)}px`;
    popover.style.left = `${Math.max(10, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 10))}px`;
    const below = window.innerHeight - rect.bottom;
    const placeAbove = below < 220 && rect.top > below;
    if (placeAbove) {
        popover.style.top = 'auto';
        popover.style.bottom = `${Math.max(10, window.innerHeight - rect.top + 5)}px`;
    } else {
        popover.style.bottom = 'auto';
        popover.style.top = `${Math.max(10, Math.min(window.innerHeight - popover.offsetHeight - 10, rect.bottom + 5))}px`;
    }
}

function closeCustomSelect() {
    const select = customSelectState.activeSelect;
    if (select) {
        const wrapper = select.closest('.custom-select');
        wrapper?.classList.remove('open');
        wrapper?.querySelector('.custom-select-button')?.setAttribute('aria-expanded', 'false');
    }
    customSelectState.activeSelect = null;
    if (customSelectState.popover) {
        customSelectState.popover.classList.add('hidden');
        customSelectState.popover.innerHTML = '';
    }
}


function applyStoredFontSize() {
    let size = 'medium';
    try { size = localStorage.getItem('mapManagerFontSize') || 'medium'; } catch (_) { /* local preference only */ }
    if (!['small', 'medium', 'large'].includes(size)) size = 'medium';
    document.documentElement.dataset.fontSize = size;
    requestAnimationFrame(() => updateFontSizeButtons(size));
}

function setFontSize(size) {
    if (!['small', 'medium', 'large'].includes(size)) return;
    document.documentElement.dataset.fontSize = size;
    try { localStorage.setItem('mapManagerFontSize', size); } catch (_) { /* local preference only */ }
    updateFontSizeButtons(size);
}

function updateFontSizeButtons(size) {
    document.querySelectorAll('[data-font-size]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.fontSize === size));
    });
}

async function initializeRepository() {
    try {
        const response = await fetch('/__manager__/info', { cache: 'no-store' });
        if (!response.ok) throw new Error('The local manager API is unavailable.');
        const info = await response.json();
        if (!info.validRepository) {
            throw new Error('Expected data/catalog.js and images/ beside app.py.');
        }

        state.repositoryReady = true;
        state.repositoryName = info.repositoryName || 'repository';
        state.apiToken = info.apiToken || '';
        state.originalCatalogText = await readTextPath('data/catalog.js');
        state.catalog = parseCatalogSource(state.originalCatalogText);
        normalizeCatalogRecords();
        state.activeSlug = null;
        state.activeHotspotIndex = null;
        state.mapHotspotIndex = null;
        state.stagedWrites.clear();
        state.stagedDeletes.clear();
        state.tempStagedPaths.clear();
        await clearTempWorkspace();
        state.selectedHotspots.clear();
        state.imageOptimizationMeta.clear();
        state.fileStats.clear();
        state.deepValidationIssues.clear();
        state.metadataHydrationComplete = false;
        state.dirty = false;
        state.pendingCountrySwitch = null;
        state.previewBaseView = null;
        state.previewView = null;
        clearDirtyIndicator();

        els.unsupported.classList.add('hidden');
        els.addCountry.disabled = false;
        els.validateAll.disabled = false;
        els.saveAll.disabled = true;
        renderCountries();
        renderWorkspace();
        hydrateCountryMetadataInBackground();
        toast(`Repository “${state.repositoryName}” detected automatically.`);
    } catch (error) {
        console.error(error);
        state.repositoryReady = false;
        setIssuesButtonState('error', '!', 'Repository not detected');
        els.unsupported.textContent = error.message || 'Could not detect the repository.';
        els.unsupported.classList.remove('hidden');
        els.countryList.innerHTML = '<div class="empty-state compact">Repository could not be loaded.</div>';
        toast(error.message || 'Could not detect repository.', true);
    }
}

function parseCatalogSource(source) {
    try {
        // Repository source is trusted local project code. Evaluating only this selected file lets
        // us keep compatibility with the current `const MAP_CATALOG = {...}` format.
        const fn = new Function(`${source}\n; return MAP_CATALOG;`); // eslint-disable-line no-new-func
        const value = fn();
        if (!value || typeof value !== 'object') throw new Error('MAP_CATALOG not found.');
        return structuredClone(value);
    } catch (error) {
        throw new Error(`Could not read data/catalog.js: ${error.message}`);
    }
}

function normalizeCatalogRecords() {
    Object.entries(state.catalog).forEach(([slug, entry]) => {
        entry.hotspots = Array.isArray(entry.hotspots) ? entry.hotspots : [];
        entry.countryName = entry.countryName || countryNameFromEntry(entry);
        entry.colorConfig = normalizeColorConfig(entry.colorConfig);
        entry.geoBounds = entry.geoBounds || null;
        entry.hotspots.forEach(h => {
            h.title = h.title || '';
            h.description = h.description || '';
            h.city = h.city || '';
            h.address = h.address || '';
            h.year = h.year ?? '';
            h.country = h.country || '';
            h.images = Array.isArray(h.images) ? h.images : (h.imageUrl ? [h.imageUrl] : []);
            h.inactiveImages = Array.isArray(h.inactiveImages) ? h.inactiveImages : [];
            // Avoid the same path being both public and intentionally inactive.
            h.inactiveImages = h.inactiveImages.filter(path => !h.images.includes(path));
            delete h.imageUrl;
            h._assetFolder = inferAssetFolder(h, slug);
            if (!h._baselinePosition) captureHotspotBaseline(h);
        });
    });
}


function optionalFiniteNumber(value) {
    // Number('') and Number(null) are both 0, which is dangerous for optional coordinates.
    // Treat blank/nullish values as missing and only accept an explicitly numeric value.
    if (value == null || (typeof value === 'string' && !value.trim())) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function captureHotspotBaseline(hotspot) {
    if (!hotspot) return;
    hotspot._baselinePosition = {
        provinceId: hotspot.provinceId || '',
        lat: optionalFiniteNumber(hotspot.lat),
        lon: optionalFiniteNumber(hotspot.lon),
        x: optionalFiniteNumber(hotspot.x),
        y: optionalFiniteNumber(hotspot.y),
        provinceOverride: Boolean(hotspot._provinceOverride),
    };
}

function refreshAllHotspotBaselines() {
    Object.values(state.catalog || {}).forEach(entry => {
        (entry.hotspots || []).forEach(captureHotspotBaseline);
    });
}


async function hydrateCountryMetadataInBackground() {
    for (const slug of Object.keys(state.catalog || {})) {
        try {
            await ensureSvgLoaded(slug);
            backfillGeographicCoordinates(slug);
        } catch (error) {
            console.warn(`Could not preflight ${slug}:`, error.message);
        }
        renderCountries();
    }
    state.metadataHydrationComplete = true;
    renderCountries();
}

function renderCountries() {
    els.countryList.innerHTML = '';
    const entries = Object.entries(state.catalog || {});
    if (!entries.length) {
        els.countryList.innerHTML = '<div class="empty-state compact">No maps yet.</div>';
        updateIssuesButton();
        return;
    }
    entries.forEach(([slug, entry]) => {
        const stats = getCountryStats(slug);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `country-item${state.activeSlug === slug ? ' active' : ''}`;
        const top = document.createElement('span');
        top.className = 'country-item-topline';
        const title = document.createElement('strong');
        title.textContent = entry.countryName || countryNameFromEntry(entry) || entry.title || slug;
        const health = document.createElement('i');
        health.className = `country-item-health ${stats.level}`;
        health.title = stats.level === 'error' ? 'Has blocking errors' : stats.level === 'warning' ? 'Needs review' : 'Ready';
        top.append(title, health);
        const meta = document.createElement('span');
        meta.className = 'country-item-statline';
        const locationLabel = `${stats.total} hotspot${stats.total === 1 ? '' : 's'}`;
        const imageLabel = `${stats.images} photo${stats.images === 1 ? '' : 's'}`;
        meta.textContent = `${locationLabel} · ${imageLabel}`;
        button.append(top, meta);
        button.addEventListener('click', () => selectCountry(slug));
        els.countryList.appendChild(button);
    });
    updateIssuesButton();
}

async function selectCountry(slug, { skipDirtyCheck = false } = {}) {
    if (!slug || slug === state.activeSlug) return;
    if (state.dirty && !skipDirtyCheck) {
        state.pendingCountrySwitch = slug;
        els.unsavedDialog.showModal();
        return;
    }
    await performCountrySelection(slug);
}


async function performCountrySelection(slug) {
    hideHotspotHoverCard();
    state.activeSlug = slug;
    state.activeHotspotIndex = null;
    state.mapHotspotIndex = null;
    state.selectedHotspots.clear();
    state.previewBaseView = null;
    state.previewView = null;
    renderCountries();
    renderWorkspace();
    try {
        await ensureSvgLoaded(slug);
        backfillGeographicCoordinates(slug);
        // Render the map first so province/position mismatches are known before the list,
        // editor badge and country health summary calculate their status colours.
        renderMapPreview();
        renderCountryHealth();
        renderImportHistory();
        renderHotspotList();
        renderEditor();
    } catch (error) {
        console.error(error);
        els.mapPreview.innerHTML = `<div class="notice notice-error">${escapeHtml(error.message)}</div>`;
        renderCountryHealth();
        renderImportHistory();
    }
}

function renderWorkspace() {
    if (!state.activeSlug) {
        els.workspace.classList.add('empty-workspace');
        els.workspaceEmpty.classList.remove('hidden');
        els.countryWorkspace.classList.add('hidden');
        return;
    }
    const entry = activeEntry();
    els.workspace.classList.remove('empty-workspace');
    els.workspaceEmpty.classList.add('hidden');
    els.countryWorkspace.classList.remove('hidden');
    renderCountryShareRoute(entry);
    els.countryTitle.textContent = entry.title || state.activeSlug;
    els.countryDescription.textContent = entry.description || '';
    renderHotspotList();
    renderEditor();
    renderCountryHealth();
    renderImportHistory();
}


function publicRouteForSlug(slug) {
    const repo = String(state.repositoryName || '').trim().replace(/^\/+|\/+$/g, '');
    return `${repo ? repo + '/' : ''}#${slug}`;
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    input.remove();
    if (!ok) throw new Error('Copy is not available in this browser.');
}

function renderCountryShareRoute(entry) {
    const countryName = entry.countryName || countryNameFromEntry(entry) || state.activeSlug;
    const route = publicRouteForSlug(state.activeSlug);
    els.countrySlug.replaceChildren();

    const name = document.createElement('span');
    name.textContent = countryName;
    const separator = document.createElement('span');
    separator.className = 'country-route-separator';
    separator.textContent = '·';
    const routeButton = document.createElement('button');
    routeButton.type = 'button';
    routeButton.className = 'country-route-copy';
    routeButton.textContent = route;
    routeButton.title = 'Copy country URL';
    routeButton.setAttribute('aria-label', `Copy country URL: ${route}`);
    routeButton.addEventListener('click', async () => {
        try {
            await copyTextToClipboard(route);
            toast(`Copied ${route}`);
        } catch (error) {
            toast(error.message || 'Could not copy the country URL.', true);
        }
    });

    els.countrySlug.append(name, separator, routeButton);
}

function activeEntry() {
    return state.activeSlug ? state.catalog[state.activeSlug] : null;
}

function activeHotspot() {
    const entry = activeEntry();
    if (!entry || state.activeHotspotIndex == null) return null;
    return entry.hotspots[state.activeHotspotIndex] || null;
}


function allManagedImages(h) {
    if (!h) return [];
    return [...new Set([...(h.images || []), ...(h.inactiveImages || [])])];
}

function setImageUse(h, path, useOnMap) {
    if (!h) return;
    h.images = Array.isArray(h.images) ? h.images : [];
    h.inactiveImages = Array.isArray(h.inactiveImages) ? h.inactiveImages : [];
    h.images = h.images.filter(item => item !== path);
    h.inactiveImages = h.inactiveImages.filter(item => item !== path);
    (useOnMap ? h.images : h.inactiveImages).push(path);
}

function renderHotspotList() {
    const entry = activeEntry();
    if (!entry) return;
    const query = (els.hotspotSearch.value || '').trim().toLowerCase();
    const filter = els.hotspotFilter?.value || 'all';
    els.hotspotCount.textContent = `${entry.hotspots.length} hotspot${entry.hotspots.length === 1 ? '' : 's'}`;
    els.hotspotList.innerHTML = '';

    const filtered = getFilteredHotspots(entry, query, filter);
    if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state large hotspot-list-empty';
        const message = document.createElement('span');
        const filteredState = Boolean(query) || filter !== 'all';
        message.textContent = filteredState ? 'No hotspots match the current filters.' : 'No hotspots yet.';
        empty.appendChild(message);
        if (filteredState) {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'button button-secondary button-small';
            clear.textContent = 'Clear filters';
            clear.addEventListener('click', () => {
                els.hotspotSearch.value = '';
                els.hotspotFilter.value = 'all';
                refreshCustomSelect(els.hotspotFilter);
                renderHotspotList();
                els.hotspotSearch.focus();
            });
            empty.appendChild(clear);
        }
        els.hotspotList.appendChild(empty);
        renderBulkToolbar(filtered);
        return;
    }

    filtered.forEach(({ hotspot, index }) => {
        const status = hotspotValidationStatus(state.activeSlug, hotspot, index);
        const row = document.createElement('div');
        row.className = `hotspot-row${index === state.activeHotspotIndex ? ' active' : ''}`;
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.innerHTML = `
            <input class="hotspot-select" type="checkbox" aria-label="Select hotspot">
            <span class="hotspot-dot ${status.level}"></span>
            <span><strong></strong><small></small></span>
            <span class="image-count"></span>`;
        const checkbox = row.querySelector('.hotspot-select');
        checkbox.checked = state.selectedHotspots.has(index);
        checkbox.addEventListener('click', event => event.stopPropagation());
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) state.selectedHotspots.add(index);
            else state.selectedHotspots.delete(index);
            renderBulkToolbar(filtered);
        });
        row.querySelector('strong').textContent = hotspot.title || '(Unnamed hotspot)';
        row.querySelector('small').textContent = [hotspot.city, hotspot.provinceId].filter(Boolean).join(' · ') || 'No location';
        const imageCount = hotspot.images?.length || 0;
        const inactiveCount = hotspot.inactiveImages?.length || 0;
        const totalImages = imageCount + inactiveCount;
        row.querySelector('.image-count').textContent = inactiveCount
            ? `${imageCount} used · ${totalImages} photo${totalImages === 1 ? '' : 's'}`
            : `${imageCount} photo${imageCount === 1 ? '' : 's'}`;
        const activate = () => selectHotspot(index);
        row.addEventListener('click', activate);
        row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
        els.hotspotList.appendChild(row);
    });
    renderBulkToolbar(filtered);
}



function getCountryStats(slug) {
    const entry = state.catalog?.[slug];
    if (!entry) return { total: 0, images: 0, errors: 0, warnings: 0, valid: 0, level: 'error' };

    // Older catalog rows can have SVG x/y but no lat/lon until their SVG has loaded once. Keep
    // that short startup migration state neutral instead of briefly painting every country red.
    if (!state.svgMeta.has(slug)) {
        let errors = 0;
        let warnings = 0;
        let valid = 0;
        entry.hotspots.forEach(h => {
            const legacyPending = optionalFiniteNumber(h.lat) == null && optionalFiniteNumber(h.lon) == null &&
                optionalFiniteNumber(h.x) != null && optionalFiniteNumber(h.y) != null;
            if (legacyPending) {
                if (!String(h.title || '').trim() || !String(h.provinceId || '').trim()) errors++;
                else warnings++;
                return;
            }
            const status = hotspotValidationStatus(slug, h, null);
            if (status.level === 'error') errors++;
            else if (status.level === 'warning') warnings++;
            else valid++;
        });
        if (!String(entry.countryName || '').trim() || !entry.svgUrl) errors++;
        const images = entry.hotspots.reduce((sum, h) => sum + allManagedImages(h).length, 0);
        return { total: entry.hotspots.length, images, errors, warnings, valid, level: errors ? 'error' : warnings ? 'warning' : 'ok' };
    }

    // Country health, hotspot dots, editor status and Issues all read from the same validation
    // functions. Deep filesystem checks are cached after a validation pass and folded back into
    // the health state until the country is edited again.
    const shallowIssues = validateCountry(slug).filter(issue => {
        return !(issue.text === 'SVG has not been loaded.' && entry.svgUrl && !state.svgMeta.has(slug));
    });
    const deepIssues = state.deepValidationIssues.get(slug) || [];
    const issues = dedupeIssues([...shallowIssues, ...deepIssues]);
    const errors = issues.filter(issue => issue.level === 'error').length;
    const warnings = issues.filter(issue => issue.level === 'warning').length;
    const valid = entry.hotspots.filter((h, index) => currentHotspotIssues(slug, h, index).length === 0).length;
    const images = entry.hotspots.reduce((sum, h) => sum + allManagedImages(h).length, 0);

    return {
        total: entry.hotspots.length,
        images,
        errors,
        warnings,
        valid,
        level: errors ? 'error' : warnings ? 'warning' : 'ok',
    };
}

function getFilteredHotspots(entry = activeEntry(), query = (els.hotspotSearch?.value || '').trim().toLowerCase(), filter = els.hotspotFilter?.value || 'all') {
    if (!entry) return [];
    return entry.hotspots
        .map((hotspot, index) => ({ hotspot, index }))
        .filter(({ hotspot, index }) => {
            const matchesQuery = !query || [hotspot.title, hotspot.city, hotspot.address, hotspot.provinceId]
                .some(value => String(value || '').toLowerCase().includes(query));
            if (!matchesQuery) return false;
            const status = hotspotValidationStatus(state.activeSlug, hotspot, index);
            if (filter === 'error' || filter === 'warning' || filter === 'ok') return status.level === filter;
            if (filter === 'missing-images') return !(hotspot.images?.length);
            if (filter === 'imported-session') return Boolean(hotspot._importedSession);
            return true;
        });
}

function renderBulkToolbar(filtered = getFilteredHotspots()) {
    const entry = activeEntry();
    if (!entry) return;
    const selected = [...state.selectedHotspots].filter(index => index >= 0 && index < entry.hotspots.length);
    els.bulkToolbar.classList.toggle('hidden', selected.length === 0);
    state.selectedHotspots = new Set(selected);
    els.bulkSelectedCount.textContent = `${selected.length} selected`;
    const visibleIndexes = filtered.map(item => item.index);
    const visibleSelected = visibleIndexes.filter(index => state.selectedHotspots.has(index)).length;
    els.bulkSelectAll.checked = visibleIndexes.length > 0 && visibleSelected === visibleIndexes.length;
    els.bulkSelectAll.indeterminate = visibleSelected > 0 && visibleSelected < visibleIndexes.length;
    [els.bulkApplyProvince, els.bulkValidate, els.bulkRemoveImages, els.bulkDelete].forEach(button => button.disabled = selected.length === 0);
    renderBulkProvinceOptions();
}

function renderBulkProvinceOptions() {
    const current = els.bulkProvince.value;
    const regions = state.svgMeta.get(state.activeSlug)?.regions || [];
    els.bulkProvince.innerHTML = '<option value="">Set province…</option>';
    regions.forEach(region => {
        const option = document.createElement('option');
        option.value = region.id;
        option.textContent = region.name && region.name !== region.id ? `${region.name} (${region.id})` : region.id;
        els.bulkProvince.appendChild(option);
    });
    if (regions.some(region => region.id === current)) els.bulkProvince.value = current;
    refreshCustomSelect(els.bulkProvince);
}

function toggleSelectAllVisible() {
    const filtered = getFilteredHotspots();
    if (els.bulkSelectAll.checked) filtered.forEach(({ index }) => state.selectedHotspots.add(index));
    else filtered.forEach(({ index }) => state.selectedHotspots.delete(index));
    renderHotspotList();
}

function applyBulkProvince() {
    const entry = activeEntry();
    const provinceId = els.bulkProvince.value;
    if (!entry || !provinceId || !state.selectedHotspots.size) return;
    state.selectedHotspots.forEach(index => {
        const h = entry.hotspots[index];
        if (!h) return;
        h.provinceId = provinceId;
        h._provinceOverride = true;
        refreshProvinceMismatch(h);
        if (!allManagedImages(h).length) h._assetFolder = generatedFacilityFolder(h, state.activeSlug);
    });
    markDirty();
    renderHotspotList();
    renderEditor();
    renderCountryHealth();
    updatePreviewMarkers();
    toast(`Province updated for ${state.selectedHotspots.size} hotspot${state.selectedHotspots.size === 1 ? '' : 's'}.`);
}

function validateBulkSelection() {
    const entry = activeEntry();
    if (!entry || !state.selectedHotspots.size) return;
    const issues = [];
    [...state.selectedHotspots].sort((a, b) => a - b).forEach(index => {
        const h = entry.hotspots[index];
        if (!h) return;
        const itemIssues = validateHotspot(state.activeSlug, h, { index });
        if (!itemIssues.length) issues.push({ level: 'ok', text: `${h.title || `Hotspot ${index + 1}`}: valid.` });
        else itemIssues.forEach(issue => issues.push({ ...issue, text: `${h.title || `Hotspot ${index + 1}`}: ${issue.text}` }));
    });
    els.validationDialogTitle.textContent = 'Validate selected hotspots';
    els.validationSummary.innerHTML = `<p class="muted">${state.selectedHotspots.size} hotspot${state.selectedHotspots.size === 1 ? '' : 's'} selected.</p>`;
    els.validationResults.innerHTML = '';
    issues.filter(issue => issue.level !== 'info').forEach(issue => appendValidationItem(els.validationResults, issue));
    els.validationDialog.showModal();
}

function removeImagesFromBulkSelection() {
    const entry = activeEntry();
    if (!entry || !state.selectedHotspots.size) return;
    let removed = 0;
    state.selectedHotspots.forEach(index => {
        const h = entry.hotspots[index];
        const managed = allManagedImages(h);
        if (!managed.length) return;
        managed.forEach(path => {
            if (state.tempStagedPaths.has(path)) { void deleteTempPath(path); state.tempStagedPaths.delete(path); }
            if (state.stagedWrites.has(path)) state.stagedWrites.delete(path);
            else state.stagedDeletes.add(path);
            state.imageOptimizationMeta.delete(path);
            state.fileStats.delete(path);
            releaseObjectUrl(path);
            removed++;
        });
        h.images = [];
        h.inactiveImages = [];
    });
    if (!removed) return toast('Selected hotspots have no images.');
    markDirty();
    renderHotspotList();
    renderEditor();
    renderCountryHealth();
    renderCountries();
    toast(`${removed} image${removed === 1 ? '' : 's'} staged for removal.`);
}

function deleteBulkSelection() {
    const entry = activeEntry();
    if (!entry || !state.selectedHotspots.size) return;
    const count = state.selectedHotspots.size;
    if (!window.confirm(`Delete ${count} selected hotspot${count === 1 ? '' : 's'}? Their image files will remain unless you remove them separately.`)) return;
    const indexes = [...state.selectedHotspots].sort((a, b) => b - a);
    indexes.forEach(index => entry.hotspots.splice(index, 1));
    state.selectedHotspots.clear();
    state.activeHotspotIndex = null;
    state.mapHotspotIndex = null;
    markDirty();
    renderHotspotList();
    renderEditor();
    renderCountryHealth();
    renderCountries();
    updatePreviewMarkers();
    toast(`${count} hotspot${count === 1 ? '' : 's'} deleted.`);
}

async function cleanupUnusedImages() {
    const entry = activeEntry();
    if (!entry) return;
    try {
        const files = await listPath(`images/${state.activeSlug}`);
        const referenced = new Set(entry.hotspots.flatMap(h => allManagedImages(h)));
        [entry.logoUrl, entry.thumbnail, entry.svgUrl].filter(Boolean).forEach(path => referenced.add(path));
        const imageExt = /\.(?:jpe?g|png|webp|gif|avif|bmp)$/i;
        const unused = files.filter(file => imageExt.test(file.path) && !referenced.has(file.path) && !state.stagedDeletes.has(file.path));
        const unusedStaged = [...state.stagedWrites.keys()].filter(path => path.startsWith(`images/${state.activeSlug}/`) && imageExt.test(path) && !referenced.has(path));
        if (!unused.length && !unusedStaged.length) return toast('No unused images were found for this country.');
        unused.forEach(file => state.stagedDeletes.add(file.path));
        unusedStaged.forEach(path => {
            if (state.tempStagedPaths.has(path)) { void deleteTempPath(path); state.tempStagedPaths.delete(path); }
            state.stagedWrites.delete(path); state.imageOptimizationMeta.delete(path); state.fileStats.delete(path); releaseObjectUrl(path);
        });
        markDirty();
        const total = unused.length + unusedStaged.length;
        toast(`${total} unused image${total === 1 ? '' : 's'} staged/removed from pending changes. Review before saving.`);
    } catch (error) {
        console.error(error);
        toast(`Could not scan unused images: ${error.message}`, true);
    }
}

function selectHotspot(index, { updatePreview = true, revealInList = false } = {}) {
    state.activeHotspotIndex = index;
    // Selecting from the list/editor intentionally syncs the map highlight.
    state.mapHotspotIndex = index;
    renderHotspotList();
    renderEditor();
    if (updatePreview) updatePreviewMarkers();
    if (revealInList) {
        requestAnimationFrame(() => {
            const activeRow = els.hotspotList?.querySelector('.hotspot-row.active');
            activeRow?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        });
    }
}

function selectMapHotspot(index) {
    // Map focus is deliberately independent from the editor/list selection. This prevents
    // switching the editor above (and changing its image-driven height) just because a marker
    // was clicked or dragged in the map.
    state.mapHotspotIndex = index;
    updatePreviewMarkers();
}

function renderEditor() {
    const h = activeHotspot();
    if (!h) {
        els.editorEmpty.classList.remove('hidden');
        els.hotspotEditor.classList.add('hidden');
        els.resetPosition.disabled = true;
        return;
    }

    els.editorEmpty.classList.add('hidden');
    els.hotspotEditor.classList.remove('hidden');
    els.resetPosition.disabled = false;
    els.fieldTitle.value = h.title || '';
    els.fieldCity.value = h.city || '';
    els.fieldYear.value = h.year ?? '';
    els.fieldAddress.value = h.address || '';
    els.fieldDescription.value = h.description || '';
    els.fieldLat.value = formatNumber(h.lat, 6);
    els.fieldLon.value = formatNumber(h.lon, 6);
    els.fieldXy.textContent = Number.isFinite(Number(h.x)) && Number.isFinite(Number(h.y))
        ? `x ${formatNumber(h.x, 3)} · y ${formatNumber(h.y, 3)}` : '-';

    renderProvinceOptions(h.provinceId || '');
    renderCoordinateMessage(h);
    renderImagesList();
    refreshHotspotReviewState(h);
}

function refreshHotspotReviewState(h = activeHotspot()) {
    if (!h || !els.hotspotStatusBadge) return;
    const issues = currentHotspotIssues(state.activeSlug, h, state.activeHotspotIndex);
    const actionable = issues.filter(issue => issue.level === 'error' || issue.level === 'warning');
    const status = hotspotValidationStatus(state.activeSlug, h, state.activeHotspotIndex);
    els.hotspotStatusBadge.textContent = status.level === 'ok' ? status.label : `${status.label} · ${actionable.length}`;
    els.hotspotStatusBadge.className = `status-badge ${status.level}`;
    els.hotspotStatusBadge.title = actionable.map(issue => issue.text).join('\n');
    renderHotspotReviewTargets(actionable);
}

function renderHotspotReviewTargets(issues = []) {
    if (!els.hotspotEditor) return;
    els.hotspotEditor.querySelectorAll('[data-hotspot-review-badge]').forEach(node => node.remove());
    els.hotspotEditor.querySelectorAll('.has-review-target').forEach(node => node.classList.remove('has-review-target'));

    const anchors = {
        title: els.fieldTitle?.closest('.field')?.querySelector(':scope > span'),
        coordinates: els.hotspotEditor.querySelector('.coordinate-heading strong'),
        province: els.fieldProvince?.closest('.field')?.querySelector(':scope > span'),
        images: els.hotspotEditor.querySelector('.images-heading strong'),
        general: els.hotspotStatusBadge?.parentElement,
    };

    const grouped = new Map();
    issues.forEach(issue => {
        const target = issue.target || 'general';
        if (!grouped.has(target)) grouped.set(target, []);
        grouped.get(target).push(issue);
    });

    grouped.forEach((targetIssues, target) => {
        const anchor = anchors[target] || anchors.general;
        if (!anchor) return;
        const hasError = targetIssues.some(issue => issue.level === 'error');
        const badge = document.createElement('span');
        const badgeText = hotspotReviewBadgeText(target, targetIssues, hasError);
        badge.dataset.hotspotReviewBadge = target;
        badge.className = `field-review-badge ${hasError ? 'error' : 'warning'}`;
        badge.textContent = badgeText;
        badge.title = targetIssues.map(issue => issue.text).join('\n');
        badge.setAttribute('aria-label', `${badgeText}: ${targetIssues.map(issue => issue.text).join(' ')}`);
        anchor.appendChild(badge);
        (anchor.closest('.field, .coordinate-card, .images-section, .editor-heading') || anchor).classList.add('has-review-target');
    });
}

function hotspotReviewBadgeText(target, issues, hasError) {
    const text = issues.map(issue => issue.text).join(' ').toLowerCase();
    if (target === 'province' && /coordinates (fall|do not fall)/.test(text)) return 'Mismatch';
    if (target === 'images' && /no images/.test(text)) return 'No images';
    if (target === 'images' && /preferred max/.test(text)) return 'Large image';
    if (target === 'title' && /possible duplicate/.test(text)) return 'Duplicate?';
    if (target === 'general' && /excel match/.test(text)) return 'Review import';
    if (hasError && /(required|missing)/.test(text)) return 'Required';
    if (target === 'coordinates') return hasError ? 'Fix' : 'Check';
    return hasError ? 'Fix' : 'Review';
}

function renderProvinceOptions(selectedId) {
    const meta = state.svgMeta.get(state.activeSlug);
    const regions = meta?.regions || [];
    els.fieldProvince.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Not detected';
    els.fieldProvince.appendChild(blank);
    regions.forEach(region => {
        const option = document.createElement('option');
        option.value = region.id;
        option.textContent = region.name && region.name !== region.id ? `${region.name} (${region.id})` : region.id;
        els.fieldProvince.appendChild(option);
    });
    if (selectedId && !regions.some(r => r.id === selectedId)) {
        const legacy = document.createElement('option');
        legacy.value = selectedId;
        legacy.textContent = `${selectedId} (not present in current SVG)`;
        els.fieldProvince.appendChild(legacy);
    }
    els.fieldProvince.value = selectedId || '';
    refreshCustomSelect(els.fieldProvince);
}

function renderCoordinateMessage(h) {
    const result = validateCoordinates(state.activeSlug, h.lat, h.lon);
    els.coordinateMessage.className = `field-message ${result.level}`;
    els.coordinateMessage.textContent = result.message;
    els.applySwap.classList.toggle('hidden', !result.suggestSwap);
}

function syncEditorTextFields() {
    const h = activeHotspot();
    if (!h) return;
    h.title = els.fieldTitle.value;
    h.city = els.fieldCity.value;
    h.year = normalizeYear(els.fieldYear.value);
    h.address = els.fieldAddress.value;
    h.description = els.fieldDescription.value;
    if (!h.country) h.country = countryNameFromEntry(activeEntry());
    if (!h._assetFolder || !allManagedImages(h).length) h._assetFolder = generatedFacilityFolder(h, state.activeSlug);
    markDirty();
    refreshHotspotReviewState(h);
    renderHotspotList();
    renderCountryHealth();
    renderCountries();
}

function syncCoordinateFields() {
    const h = activeHotspot();
    if (!h) return;
    h.lat = parseCoordinate(els.fieldLat.value, 'lat');
    h.lon = parseCoordinate(els.fieldLon.value, 'lon');
    const validation = validateCoordinates(state.activeSlug, h.lat, h.lon);
    if (validation.level !== 'error') {
        const meta = state.svgMeta.get(state.activeSlug);
        if (meta) {
            const xy = latLonToXY(h.lat, h.lon, meta.bounds, meta.viewBox);
            h.x = xy.x;
            h.y = xy.y;
            const detectedProvince = detectProvinceAtXY(xy.x, xy.y);
            if (!h.provinceId) h.provinceId = detectedProvince || '';
            h._positionSource = 'coordinates';
            h._provinceOverride = Boolean(h.provinceId);
            refreshProvinceMismatch(h, detectedProvince);
            if (!allManagedImages(h).length) h._assetFolder = generatedFacilityFolder(h, state.activeSlug);
        }
    }
    markDirty();
    renderEditor();
    renderHotspotList();
    renderCountryHealth();
    renderCountries();
    updatePreviewMarkers();
}

function syncProvinceField() {
    const h = activeHotspot();
    if (!h) return;
    h.provinceId = els.fieldProvince.value;
    h._provinceOverride = true;
    refreshProvinceMismatch(h);
    if (!allManagedImages(h).length) h._assetFolder = generatedFacilityFolder(h, state.activeSlug);
    markDirty();
    refreshHotspotReviewState(h);
    renderHotspotList();
    renderCountryHealth();
    renderCountries();
    updatePreviewMarkers();
}

function applySuggestedSwap() {
    const h = activeHotspot();
    if (!h) return;
    const result = validateCoordinates(state.activeSlug, h.lat, h.lon);
    if (!result.suggestSwap) return;
    const oldLat = h.lat;
    h.lat = h.lon;
    h.lon = oldLat;
    syncHotspotFromCoordinates(h, { redetectProvince: false });
    refreshProvinceMismatch(h);
    h._coordinateSwapAccepted = true;
    markDirty();
    renderEditor();
    renderHotspotList();
    renderCountryHealth();
    renderCountries();
    updatePreviewMarkers();
}

function addHotspot() {
    const entry = activeEntry();
    const meta = state.svgMeta.get(state.activeSlug);
    if (!entry || !meta) {
        toast('Load a valid country SVG before adding hotspots.', true);
        return;
    }
    const lat = (meta.bounds.maxLat + meta.bounds.minLat) / 2;
    const lon = (meta.bounds.maxLon + meta.bounds.minLon) / 2;
    const xy = latLonToXY(lat, lon, meta.bounds, meta.viewBox);
    const hotspot = {
        provinceId: detectProvinceAtXY(xy.x, xy.y) || '',
        title: 'New Hotspot',
        description: '',
        country: countryNameFromEntry(entry),
        city: '',
        year: '',
        address: '',
        lat,
        lon,
        x: xy.x,
        y: xy.y,
        images: [],
        inactiveImages: [],
        _positionSource: 'manual-new',
    };
    hotspot._assetFolder = generatedFacilityFolder(hotspot, state.activeSlug);
    captureHotspotBaseline(hotspot);
    entry.hotspots.push(hotspot);
    state.activeHotspotIndex = entry.hotspots.length - 1;
    state.mapHotspotIndex = state.activeHotspotIndex;
    markDirty();
    renderHotspotList();
    renderEditor();
    renderCountryHealth();
    renderCountries();
    updatePreviewMarkers();
    requestAnimationFrame(() => els.fieldTitle.select());
}

async function ensureSvgLoaded(slug) {
    if (state.svgSources.has(slug) && state.svgMeta.has(slug)) return;
    const entry = state.catalog[slug];
    if (!entry?.svgUrl) throw new Error('This map has no svgUrl.');
    const source = await readTextPath(entry.svgUrl);
    const meta = parseSvgMetadata(source);
    state.svgSources.set(slug, source);
    state.svgMeta.set(slug, meta);
    if (!entry.geoBounds || !sameBounds(entry.geoBounds, meta.bounds)) entry.geoBounds = { ...meta.bounds };
}

function parseSvgMetadata(source) {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) throw new Error('The SVG could not be parsed.');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('Selected file is not an SVG.');

    const viewBoxRaw = svg.getAttribute('viewBox') || svg.getAttribute('viewbox');
    let viewBox = parseNumberList(viewBoxRaw);
    if (viewBox.length !== 4) {
        const width = parseFloat(svg.getAttribute('width'));
        const height = parseFloat(svg.getAttribute('height'));
        if (Number.isFinite(width) && Number.isFinite(height)) viewBox = [0, 0, width, height];
    }
    if (viewBox.length !== 4 || viewBox[2] <= 0 || viewBox[3] <= 0) {
        throw new Error('SVG must contain a valid viewBox (or numeric width/height).');
    }

    const geoRaw = svg.getAttribute('mapsvg:geoViewBox') || svg.getAttribute('geoViewBox') ||
        Array.from(svg.attributes).find(a => a.name.endsWith(':geoViewBox'))?.value;
    const geo = parseNumberList(geoRaw);
    if (geo.length !== 4) {
        throw new Error('SVG is missing mapsvg:geoViewBox geographic bounds.');
    }
    const bounds = { minLon: geo[0], maxLat: geo[1], maxLon: geo[2], minLat: geo[3] };
    if (!(bounds.maxLon > bounds.minLon) || !(bounds.maxLat > bounds.minLat)) {
        throw new Error('SVG mapsvg:geoViewBox bounds are not in minLon, maxLat, maxLon, minLat order.');
    }

    const regionNodes = Array.from(doc.querySelectorAll('path[id], polygon[id], polyline[id], rect[id], circle[id], ellipse[id]'));
    const parsedRegions = regionNodes
        .map(node => ({
            id: node.id.trim(),
            name: (node.getAttribute('data-name') || node.getAttribute('title') || node.querySelector(':scope > title')?.textContent || node.id).trim(),
            code: (node.getAttribute('data-code') || node.getAttribute('data-abbr') || node.getAttribute('data-label') || '').trim(),
        }))
        .filter(region => region.id && region.id !== 'hotspots-layer' && region.id !== 'manager-hotspot-layer' && region.id !== 'manager-region-label-layer');

    const idCounts = new Map();
    parsedRegions.forEach(region => idCounts.set(region.id, (idCounts.get(region.id) || 0) + 1));
    const duplicateRegionIds = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    const seenRegionIds = new Set();
    const regions = parsedRegions.filter(region => {
        if (seenRegionIds.has(region.id)) return false;
        seenRegionIds.add(region.id);
        return true;
    });

    return {
        bounds,
        viewBox: { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] },
        regions,
        duplicateRegionIds,
    };
}

function parseNumberList(value) {
    if (!value) return [];
    return String(value).trim().split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite);
}

function sameBounds(a, b) {
    return ['minLon', 'maxLat', 'maxLon', 'minLat'].every(key => Math.abs(Number(a[key]) - Number(b[key])) < 1e-8);
}

function backfillGeographicCoordinates(slug) {
    const entry = state.catalog[slug];
    const meta = state.svgMeta.get(slug);
    if (!entry || !meta) return;
    entry.hotspots.forEach(h => {
        if ((!Number.isFinite(Number(h.lat)) || !Number.isFinite(Number(h.lon))) && Number.isFinite(Number(h.x)) && Number.isFinite(Number(h.y))) {
            const ll = xyToLatLon(Number(h.x), Number(h.y), meta.bounds, meta.viewBox);
            h.lat = ll.lat;
            h.lon = ll.lon;
            h._backfilledLatLon = true;

            // Legacy catalog entries may have had their reset baseline captured before
            // geographic coordinates existed. Complete that baseline as soon as the
            // coordinates are derived so Reset selected can never blank lat/lon.
            if (h._baselinePosition) {
                if (optionalFiniteNumber(h._baselinePosition.lat) == null) h._baselinePosition.lat = ll.lat;
                if (optionalFiniteNumber(h._baselinePosition.lon) == null) h._baselinePosition.lon = ll.lon;
            }
        }
        h._assetFolder = allManagedImages(h).length
            ? inferAssetFolder(h, slug)
            : generatedFacilityFolder(h, slug);
    });
}

function latLonToXY(lat, lon, bounds, viewBox) {
    const xRatio = (Number(lon) - bounds.minLon) / (bounds.maxLon - bounds.minLon);
    const yRatio = (bounds.maxLat - Number(lat)) / (bounds.maxLat - bounds.minLat);
    return {
        x: round(viewBox.x + xRatio * viewBox.width, 4),
        y: round(viewBox.y + yRatio * viewBox.height, 4),
    };
}

function xyToLatLon(x, y, bounds, viewBox) {
    const xRatio = (Number(x) - viewBox.x) / viewBox.width;
    const yRatio = (Number(y) - viewBox.y) / viewBox.height;
    return {
        lon: round(bounds.minLon + xRatio * (bounds.maxLon - bounds.minLon), 7),
        lat: round(bounds.maxLat - yRatio * (bounds.maxLat - bounds.minLat), 7),
    };
}

function syncHotspotFromCoordinates(h, { redetectProvince = false } = {}) {
    const meta = state.svgMeta.get(state.activeSlug);
    if (!meta) return;
    const validation = validateCoordinates(state.activeSlug, h.lat, h.lon);
    if (validation.level === 'error') return;
    const xy = latLonToXY(h.lat, h.lon, meta.bounds, meta.viewBox);
    h.x = xy.x;
    h.y = xy.y;
    const detectedProvince = detectProvinceAtXY(xy.x, xy.y);
    if (redetectProvince || !h.provinceId) {
        h.provinceId = detectedProvince || h.provinceId || '';
    }
    h._provinceOverride = Boolean(h.provinceId);
    refreshProvinceMismatch(h, detectedProvince);
    if (!allManagedImages(h).length) h._assetFolder = generatedFacilityFolder(h, state.activeSlug);
}

function renderMapPreview() {
    const slug = state.activeSlug;
    const source = state.svgSources.get(slug);
    const meta = state.svgMeta.get(slug);
    if (!source || !meta) return;
    els.mapPreview.innerHTML = source;
    const svg = previewSvg();
    if (!svg) {
        els.mapPreview.innerHTML = '<div class="notice notice-error">SVG did not contain a root &lt;svg&gt; element.</div>';
        return;
    }

    // MapSVG exports may provide width/height without a viewBox. Normalize only the
    // editor preview; the original country SVG remains untouched on disk.
    const base = { x: meta.viewBox.x, y: meta.viewBox.y, width: meta.viewBox.width, height: meta.viewBox.height };
    state.previewBaseView = base;
    state.previewView = { ...base };
    applyPreviewViewBox();
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    applyPreviewMapColors(svg, activeEntry());
    renderRegionLabels(svg);
    initializeMapNavigation(svg);
    updatePreviewMarkers();
}

function applyPreviewMapColors(svg, entry) {
    if (!svg || !entry) return;
    const config = normalizeColorConfig(entry.colorConfig);
    const anchor = hexToHsl(config.baseColor);
    const baseHue = anchor?.h ?? Number(config.baseHue ?? 175);
    const satNumber = anchor?.s ?? clamp(parseFloat(String(config.sat ?? '50').replace('%', '')) || 50, 0, 100);
    const minLight = clamp(Number(config.minLight ?? 75), 0, 100);
    const maxLight = clamp(Number(config.maxLight ?? 85), 0, 100);
    const exactColour = /^#[0-9a-f]{6}$/i.test(config.baseColor) && Math.abs(maxLight - minLight) < 0.0001
        ? config.baseColor.toLowerCase()
        : '';
    const shapes = Array.from(svg.querySelectorAll('path[id], polygon[id], polyline[id], rect[id], circle[id], ellipse[id]'))
        .filter(el => el.id && el.id !== 'hotspots-layer' && el.id !== 'manager-hotspot-layer' && el.id !== 'manager-region-label-layer');
    shapes.forEach((el, index) => {
        const t = shapes.length > 1 ? index / (shapes.length - 1) : 0.5;
        const light = maxLight - t * (maxLight - minLight);
        const fill = exactColour || `hsl(${round(baseHue, 4)}, ${round(satNumber, 4)}%, ${round(light, 4)}%)`;
        el.setAttribute('fill', fill);
        el.setAttribute('stroke', 'rgba(255,255,255,.92)');
        el.setAttribute('stroke-width', '0.6');
        el.setAttribute('vector-effect', 'non-scaling-stroke');
    });
}

const REGION_LABEL_MODE_KEY = 'mapped-out-region-label-mode';

function currentRegionLabelMode() {
    const pressed = els.mapLabelMode?.querySelector('[data-region-label-mode][aria-pressed="true"]');
    return pressed?.dataset.regionLabelMode || 'codes';
}

function bindRegionLabelMode() {
    if (!els.mapLabelMode) return;
    const allowed = new Set(['off', 'codes', 'numbers']);
    let saved = 'codes';
    try {
        const stored = localStorage.getItem(REGION_LABEL_MODE_KEY);
        if (allowed.has(stored)) saved = stored;
    } catch (_) {}
    setRegionLabelMode(saved, { persist: false, rerender: false });
    els.mapLabelMode.querySelectorAll('[data-region-label-mode]').forEach(button => {
        button.addEventListener('click', () => setRegionLabelMode(button.dataset.regionLabelMode));
    });
}

function setRegionLabelMode(mode, { persist = true, rerender = true } = {}) {
    const normalized = ['off', 'codes', 'numbers'].includes(mode) ? mode : 'codes';
    els.mapLabelMode?.querySelectorAll('[data-region-label-mode]').forEach(button => {
        button.setAttribute('aria-pressed', button.dataset.regionLabelMode === normalized ? 'true' : 'false');
    });
    if (persist) {
        try { localStorage.setItem(REGION_LABEL_MODE_KEY, normalized); } catch (_) {}
    }
    if (rerender) renderRegionLabels();
}

function renderRegionLabels(svg = previewSvg()) {
    const meta = state.svgMeta.get(state.activeSlug);
    if (!svg || !meta) return;
    svg.querySelector('#manager-region-label-layer')?.remove();
    const mode = currentRegionLabelMode();
    if (mode === 'off') return;
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.id = 'manager-region-label-layer';
    layer.setAttribute('aria-hidden', 'true');
    const shortSide = Math.min(meta.viewBox.width, meta.viewBox.height);
    meta.regions.forEach(region => {
        const shape = svg.querySelector(`[id="${cssEscape(region.id)}"]`);
        if (!shape || shape.closest('#manager-region-label-layer')) return;
        let box;
        try { box = shape.getBBox(); } catch (_) { return; }
        if (!box || box.width <= 0 || box.height <= 0) return;
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', round(box.x + box.width / 2, 3));
        text.setAttribute('y', round(box.y + box.height / 2, 3));
        const label = regionLabelText(region, mode, state.activeSlug);
        if (!label) return;
        const localSize = Math.min(box.width, box.height) * 0.28;
        const readableFloor = shortSide / 72;
        const baseFontSize = clamp(localSize, readableFloor, shortSide / 46);
        const labelScale = clamp(4 / Math.max(3, label.length), 0.82, 1);
        const fontSize = Math.max(readableFloor, baseFontSize * labelScale);
        text.setAttribute('font-size', round(fontSize, 3));
        text.setAttribute('class', 'manager-region-label');
        text.textContent = label;
        layer.appendChild(text);
    });

    // Region text must always stay visually behind hotspot markers. Toggling the label mode
    // used to append this layer after the markers, which could make labels cover hotspots.
    const markerLayer = svg.querySelector('#manager-hotspot-layer');
    if (markerLayer) svg.insertBefore(layer, markerLayer);
    else svg.appendChild(layer);
}

function resolveRegionCountryCode(region, slug = state.activeSlug) {
    const id = String(region?.id || region || '').trim().toUpperCase();
    if (!id) return { label: '', resolved: false, source: 'missing' };

    const explicit = String(region?.code || '').trim().toUpperCase();
    if (explicit) return { label: explicit, resolved: true, source: 'svg' };

    const override = REGION_CODE_OVERRIDES[String(slug || '').toLowerCase()]?.[id];
    if (override) return { label: String(override).trim().toUpperCase(), resolved: true, source: 'metadata' };

    // Alphabetic suffixes are safe human-facing codes. Support both ISO-style hyphens and
    // older underscore IDs such as PH_MG.
    const parts = id.split(/[-_]/).filter(Boolean);
    const suffix = parts.length > 1 ? parts[parts.length - 1] : id;
    if (/[A-Z]/.test(suffix) && !/^\d+$/.test(suffix)) {
        return { label: suffix, resolved: true, source: 'svg-id' };
    }

    // Numeric/raw identifiers are legitimate SVG IDs, but inventing an abbreviation from the
    // province name is not deterministic. Show a visible placeholder and let validation explain
    // how to supply data-code/data-abbr/data-label or a country metadata entry.
    return { label: '?', resolved: false, source: 'unresolved' };
}

function regionLabelText(region, mode = 'codes', slug = state.activeSlug) {
    const id = String(region?.id || region || '').trim().toUpperCase();
    if (!id) return '';
    if (mode === 'numbers') return id;
    return resolveRegionCountryCode(region, slug).label;
}

function unresolvedRegionCountryCodes(slug) {
    const regions = state.svgMeta.get(slug)?.regions || [];
    return regions.filter(region => !resolveRegionCountryCode(region, slug).resolved);
}

function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function previewSvg() {
    return els.mapPreview.querySelector('svg');
}

function applyPreviewViewBox() {
    const svg = previewSvg();
    const view = state.previewView;
    if (!svg || !view) return;
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
}

function resetPreviewView() {
    if (!state.previewBaseView) return;
    state.previewView = { ...state.previewBaseView };
    applyPreviewViewBox();
    hideHotspotHoverCard();
}

function zoomPreview(factor, anchor = null) {
    const base = state.previewBaseView;
    const view = state.previewView;
    if (!base || !view) return;
    const minScale = 1 / 24;
    const targetWidth = clamp(view.width * factor, base.width * minScale, base.width);
    const targetHeight = clamp(view.height * factor, base.height * minScale, base.height);
    if (Math.abs(targetWidth - view.width) < 1e-8) return;

    const point = anchor || { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    const rx = (point.x - view.x) / view.width;
    const ry = (point.y - view.y) / view.height;
    const next = {
        x: point.x - rx * targetWidth,
        y: point.y - ry * targetHeight,
        width: targetWidth,
        height: targetHeight,
    };
    state.previewView = clampPreviewView(next);
    applyPreviewViewBox();
    hideHotspotHoverCard();
}

function clampPreviewView(view) {
    const base = state.previewBaseView;
    if (!base) return view;
    const maxX = base.x + base.width - view.width;
    const maxY = base.y + base.height - view.height;
    return {
        ...view,
        x: clamp(view.x, base.x, Math.max(base.x, maxX)),
        y: clamp(view.y, base.y, Math.max(base.y, maxY)),
    };
}

function initializeMapNavigation(svg) {
    svg.classList.add('manager-map-svg');

    // Keep ordinary wheel gestures available for page scrolling. Ctrl + wheel is reserved for
    // editor zoom and anchors the zoom at the pointer, matching the + / − controls without
    // hijacking normal scrolling through the manager.
    svg.addEventListener('wheel', event => {
        if (!event.ctrlKey || !state.previewView) return;
        event.preventDefault();
        event.stopPropagation();
        const anchor = clientToSvg(svg, event.clientX, event.clientY);
        const factor = clamp(Math.exp(event.deltaY * 0.0018), 0.72, 1.38);
        zoomPreview(factor, anchor);
    }, { passive: false });

    svg.addEventListener('pointerdown', event => {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        if (event.target.closest?.('#manager-hotspot-layer')) return;
        if (!state.previewView) return;
        event.preventDefault();
        hideHotspotHoverCard();
        const rect = svg.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const startView = { ...state.previewView };
        svg.classList.add('is-panning');
        svg.setPointerCapture(event.pointerId);

        const move = moveEvent => {
            moveEvent.preventDefault();
            const dx = (moveEvent.clientX - startX) * (startView.width / Math.max(rect.width, 1));
            const dy = (moveEvent.clientY - startY) * (startView.height / Math.max(rect.height, 1));
            state.previewView = clampPreviewView({ ...startView, x: startView.x - dx, y: startView.y - dy });
            applyPreviewViewBox();
        };
        const up = () => {
            svg.classList.remove('is-panning');
            svg.removeEventListener('pointermove', move);
            svg.removeEventListener('pointerup', up);
            svg.removeEventListener('pointercancel', up);
        };
        svg.addEventListener('pointermove', move);
        svg.addEventListener('pointerup', up);
        svg.addEventListener('pointercancel', up);
    });
}

function updatePreviewMarkers() {
    const svg = previewSvg();
    const entry = activeEntry();
    const meta = state.svgMeta.get(state.activeSlug);
    if (!svg || !entry || !meta) return;
    svg.querySelector('#manager-hotspot-layer')?.remove();

    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.id = 'manager-hotspot-layer';
    svg.appendChild(layer);

    // Keep markers clearly visible even on tall/narrow country maps. The interaction area
    // deliberately matches the visible marker so nearby hotspots never steal each other's clicks.
    const shortSide = Math.min(meta.viewBox.width, meta.viewBox.height);
    const radius = Math.max(shortSide / 75, 4);

    const markerOrder = entry.hotspots.map((_, index) => index);
    if (Number.isInteger(state.mapHotspotIndex)) {
        markerOrder.sort((a, b) => (a === state.mapHotspotIndex ? 1 : 0) - (b === state.mapHotspotIndex ? 1 : 0));
    }

    markerOrder.forEach(index => {
        const h = entry.hotspots[index];
        if (!Number.isFinite(Number(h.x)) || !Number.isFinite(Number(h.y))) return;
        refreshProvinceMismatch(h);
        const status = hotspotValidationStatus(state.activeSlug, h, index);
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.dataset.index = String(index);

        const selected = index === state.mapHotspotIndex;
        const markerRadius = radius;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', h.x);
        circle.setAttribute('cy', h.y);
        circle.setAttribute('r', markerRadius);
        circle.setAttribute('class', `manager-hotspot-marker ${status.level}${selected ? ' selected' : ''}`);

        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hit.setAttribute('cx', h.x);
        hit.setAttribute('cy', h.y);
        hit.setAttribute('r', markerRadius);
        hit.setAttribute('class', 'manager-hotspot-hit');
        hit.dataset.index = String(index);
        hit.addEventListener('pointerdown', beginMarkerDrag);
        hit.addEventListener('pointerenter', event => showHotspotHoverCard(event, h));
        hit.addEventListener('pointermove', event => positionHotspotHoverCard(event));
        hit.addEventListener('pointerleave', hideHotspotHoverCard);
        hit.addEventListener('click', event => {
            if (hit.dataset.suppressClick === '1') {
                delete hit.dataset.suppressClick;
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            event.stopPropagation();
            selectMapHotspot(index);
        });

        group.append(circle, hit);
        layer.appendChild(group);
    });
}

function showHotspotHoverCard(event, hotspot) {
    if (!hotspot || !els.hotspotHoverCard) return;
    const name = hotspot.title || 'Unnamed facility';
    const city = (hotspot.city || '').trim();
    const lat = Number.isFinite(Number(hotspot.lat)) ? formatNumber(hotspot.lat, 6) : '-';
    const lon = Number.isFinite(Number(hotspot.lon)) ? formatNumber(hotspot.lon, 6) : '-';
    els.hotspotHoverCard.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = name;
    els.hotspotHoverCard.appendChild(strong);
    if (city) {
        const place = document.createElement('span');
        place.textContent = city;
        els.hotspotHoverCard.appendChild(place);
    }
    const coords = document.createElement('code');
    coords.textContent = `${lat}, ${lon}`;
    els.hotspotHoverCard.appendChild(coords);
    els.hotspotHoverCard.classList.remove('hidden');
    positionHotspotHoverCard(event);
}

function positionHotspotHoverCard(event) {
    if (!els.hotspotHoverCard || els.hotspotHoverCard.classList.contains('hidden') || !els.mapStage) return;
    const stage = els.mapStage.getBoundingClientRect();
    const card = els.hotspotHoverCard;
    const margin = 12;
    let left = event.clientX - stage.left + 16;
    let top = event.clientY - stage.top - 10;
    const width = card.offsetWidth || 220;
    const height = card.offsetHeight || 70;
    if (left + width + margin > stage.width) left = event.clientX - stage.left - width - 16;
    if (top + height + margin > stage.height) top = stage.height - height - margin;
    top = Math.max(margin, top);
    left = Math.max(margin, left);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
}

function hideHotspotHoverCard() {
    if (!els.hotspotHoverCard) return;
    els.hotspotHoverCard.classList.add('hidden');
}

let markerDragScrollLock = null;

function lockPageScrollForMarkerDrag(pointerId) {
    if (markerDragScrollLock || !els.workspace) return null;
    const workspace = els.workspace;
    const lock = {
        scrollTop: workspace.scrollTop,
        scrollLeft: workspace.scrollLeft,
        shield: null,
        scrollHandler: null,
    };

    document.documentElement.classList.add('manager-marker-dragging');
    workspace.classList.add('map-drag-lock');

    // The application now uses the workspace as its scroll container instead of the document.
    // During a marker drag we freeze that one container. This avoids Chromium's native edge
    // autoscroll without changing body positioning, so sticky/header/sidebar UI never disappears.
    lock.scrollHandler = () => {
        if (!markerDragScrollLock) return;
        if (workspace.scrollTop !== lock.scrollTop) workspace.scrollTop = lock.scrollTop;
        if (workspace.scrollLeft !== lock.scrollLeft) workspace.scrollLeft = lock.scrollLeft;
    };
    workspace.addEventListener('scroll', lock.scrollHandler, { passive: true });

    const shield = document.createElement('div');
    shield.className = 'marker-drag-shield';
    shield.setAttribute('aria-hidden', 'true');
    document.body.appendChild(shield);
    lock.shield = shield;
    markerDragScrollLock = lock;

    // Pointer capture is intentionally moved to a fixed overlay. The overlay does not move with
    // the SVG marker and prevents the browser from treating the drag as selection/dragging page
    // content when the physical pointer approaches the viewport edge.
    try { shield.setPointerCapture(pointerId); } catch (_) { }
    return lock;
}

function unlockPageScrollForMarkerDrag() {
    const lock = markerDragScrollLock;
    if (!lock) return;
    markerDragScrollLock = null;
    const workspace = els.workspace;
    if (workspace && lock.scrollHandler) workspace.removeEventListener('scroll', lock.scrollHandler);
    if (workspace) {
        workspace.classList.remove('map-drag-lock');
        workspace.scrollTop = lock.scrollTop;
        workspace.scrollLeft = lock.scrollLeft;
    }
    lock.shield?.remove();
    document.documentElement.classList.remove('manager-marker-dragging');
}

function beginMarkerDrag(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    hideHotspotHoverCard();
    const hit = event.currentTarget;
    const index = Number(hit.dataset.index);
    const svg = previewSvg();
    const entry = activeEntry();
    const meta = state.svgMeta.get(state.activeSlug);
    if (!svg || !entry || !meta || !Number.isInteger(index) || !entry.hotspots[index]) return;

    state.mapHotspotIndex = index;
    const h = entry.hotspots[index];
    const group = hit.parentElement;
    const marker = group?.querySelector('.manager-hotspot-marker');
    if (!marker) return;

    svg.querySelectorAll('.manager-hotspot-marker.selected').forEach(node => node.classList.remove('selected'));
    marker.classList.add('selected');
    hit.classList.add('dragging');
    const dragLock = lockPageScrollForMarkerDrag(event.pointerId);
    const eventTarget = dragLock?.shield || hit;
    if (eventTarget === hit) {
        try { hit.setPointerCapture(event.pointerId); } catch (_) { }
    }

    let moved = false;
    let finalX = Number(h.x);
    let finalY = Number(h.y);

    const move = moveEvent => {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        const point = clientToSvg(svg, moveEvent.clientX, moveEvent.clientY);
        if (!point) return;
        const x = clamp(point.x, meta.viewBox.x, meta.viewBox.x + meta.viewBox.width);
        const y = clamp(point.y, meta.viewBox.y, meta.viewBox.y + meta.viewBox.height);
        finalX = round(x, 4);
        finalY = round(y, 4);
        moved = moved || Math.abs(finalX - Number(h.x)) > 0.0001 || Math.abs(finalY - Number(h.y)) > 0.0001;
        marker.setAttribute('cx', finalX);
        marker.setAttribute('cy', finalY);
        hit.setAttribute('cx', finalX);
        hit.setAttribute('cy', finalY);

        const detectedProvince = detectProvinceAtXY(finalX, finalY);
        const priorMismatch = h._provinceMismatch;
        refreshProvinceMismatch(h, detectedProvince);
        const dragStatus = hotspotValidationStatus(state.activeSlug, h, index);
        marker.classList.remove('ok', 'warning', 'error');
        marker.classList.add(dragStatus.level);
        h._provinceMismatch = priorMismatch;
    };

    const finish = upEvent => {
        upEvent?.preventDefault?.();
        upEvent?.stopPropagation?.();
        eventTarget.removeEventListener('pointermove', move);
        eventTarget.removeEventListener('pointerup', finish);
        eventTarget.removeEventListener('pointercancel', finish);
        eventTarget.removeEventListener('lostpointercapture', finish);
        hit.classList.remove('dragging');

        if (moved) {
            h.x = finalX;
            h.y = finalY;
            const ll = xyToLatLon(h.x, h.y, meta.bounds, meta.viewBox);
            h.lat = ll.lat;
            h.lon = ll.lon;
            const detectedProvince = detectProvinceAtXY(h.x, h.y);
            if (!h.provinceId) h.provinceId = detectedProvince || '';
            h._positionSource = 'manual-drag';
            h._provinceOverride = Boolean(h.provinceId);
            refreshProvinceMismatch(h, detectedProvince);
            if (!allManagedImages(h).length) h._assetFolder = generatedFacilityFolder(h, state.activeSlug);
            hit.dataset.suppressClick = '1';
        }

        unlockPageScrollForMarkerDrag();
        if (moved) markDirty();
        // Never switch or rebuild the editor/list because a marker was moved on the map.
        // If this same hotspot was already selected above, refresh only its editor fields once.
        if (state.activeHotspotIndex === index) renderEditor();
        renderCountryHealth();
        renderCountries();
        updatePreviewMarkers();
    };

    eventTarget.addEventListener('pointermove', move, { passive: false });
    eventTarget.addEventListener('pointerup', finish, { passive: false });
    eventTarget.addEventListener('pointercancel', finish, { passive: false });
    eventTarget.addEventListener('lostpointercapture', finish, { passive: false });
}

function clientToSvg(svg, clientX, clientY) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
}

function detectProvinceAtXY(x, y) {
    const svg = previewSvg();
    if (!svg || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return '';
    const rootScreen = svg.getScreenCTM();
    if (!rootScreen) return '';
    const screenPoint = new DOMPoint(Number(x), Number(y)).matrixTransform(rootScreen);
    const candidates = Array.from(svg.querySelectorAll('path[id], polygon[id], polyline[id], rect[id], circle[id], ellipse[id]'))
        .filter(el => el.id && el.id !== 'hotspots-layer' && el.id !== 'manager-hotspot-layer' && !el.closest('#manager-hotspot-layer'));

    for (const el of candidates) {
        try {
            const elementScreen = el.getScreenCTM();
            if (!elementScreen) continue;
            const local = screenPoint.matrixTransform(elementScreen.inverse());
            if (typeof el.isPointInFill === 'function' && el.isPointInFill(local)) return el.id;
        } catch (_) {
            // Fall through to the conservative bbox fallback below.
        }
    }

    // A fallback for SVG implementations where isPointInFill is unavailable. It is less
    // precise, so it is only used after exact geometry checks fail.
    for (const el of candidates) {
        try {
            const bb = el.getBBox();
            if (x >= bb.x && x <= bb.x + bb.width && y >= bb.y && y <= bb.y + bb.height) return el.id;
        } catch (_) { /* ignore */ }
    }
    return '';
}

function resolveHotspotBaseline(hotspot) {
    if (!hotspot?._baselinePosition) return null;
    const baseline = hotspot._baselinePosition;
    const meta = state.svgMeta.get(state.activeSlug);

    let lat = optionalFiniteNumber(baseline.lat);
    let lon = optionalFiniteNumber(baseline.lon);
    let x = optionalFiniteNumber(baseline.x);
    let y = optionalFiniteNumber(baseline.y);

    // x/y is the actual map position that Reset is restoring, so when it exists it is
    // authoritative. Always derive lat/lon from that saved map position. This also repairs
    // baselines produced by older builds where blank/null lat/lon could accidentally become 0.
    if (x != null && y != null && meta) {
        const ll = xyToLatLon(x, y, meta.bounds, meta.viewBox);
        lat = ll.lat;
        lon = ll.lon;
    } else if (lat != null && lon != null && meta) {
        const xy = latLonToXY(lat, lon, meta.bounds, meta.viewBox);
        x = xy.x;
        y = xy.y;
    }

    if ([lat, lon, x, y].some(value => value == null || !Number.isFinite(value))) return null;

    // Heal the stored baseline so subsequent resets do not need reconstruction.
    baseline.lat = lat;
    baseline.lon = lon;
    baseline.x = x;
    baseline.y = y;

    return {
        lat, lon, x, y,
        provinceId: baseline.provinceId || '',
        provinceOverride: Boolean(baseline.provinceOverride),
    };
}

function resetSelectedHotspot() {
    const h = activeHotspot();
    if (!h) return;
    const baseline = resolveHotspotBaseline(h);
    if (!baseline) {
        toast('This hotspot has no complete position to reset to.', true);
        return;
    }

    h.lat = baseline.lat;
    h.lon = baseline.lon;
    h.x = baseline.x;
    h.y = baseline.y;
    h.provinceId = baseline.provinceId || detectProvinceAtXY(baseline.x, baseline.y) || '';
    h._provinceOverride = Boolean(h.provinceId);
    refreshProvinceMismatch(h);
    h._positionSource = 'reset';

    markDirty();
    renderEditor();
    renderHotspotList();
    renderCountryHealth();
    renderCountries();
    updatePreviewMarkers();
    toast('Selected hotspot position reset.');
}


async function handleSvgReplacement(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !state.activeSlug) return;
    try {
        const source = await file.text();
        const meta = parseSvgMetadata(source);
        const entry = activeEntry();
        const path = entry.svgUrl || `images/${state.activeSlug}/${state.activeSlug}.svg`;
        entry.svgUrl = path;
        entry.thumbnail = path;
        entry.geoBounds = { ...meta.bounds };
        state.svgSources.set(state.activeSlug, source);
        state.svgMeta.set(state.activeSlug, meta);
        state.stagedWrites.set(path, file);
        backfillGeographicCoordinates(state.activeSlug);
        entry.hotspots.forEach(h => syncHotspotFromCoordinates(h, { redetectProvince: false }));
        markDirty();
        renderMapPreview();
        await nextFrame();
        entry.hotspots.forEach(h => {
            const detectedProvince = detectProvinceAtXY(h.x, h.y);
            if (!h.provinceId) h.provinceId = detectedProvince || '';
            h._provinceOverride = Boolean(h.provinceId);
            refreshProvinceMismatch(h, detectedProvince);
        });
        renderEditor();
        renderHotspotList();
        renderCountryHealth();
        renderCountries();
        updatePreviewMarkers();
        toast('SVG replaced. Hotspot positions were regenerated from latitude/longitude.');
    } catch (error) {
        console.error(error);
        toast(error.message || 'Could not replace SVG.', true);
    }
}

function openCountryDialog(mode) {
    state.countryDialogMode = mode;
    els.countryForm.reset();
    els.countryFormMessage.classList.add('hidden');
    if (mode === 'add') {
        els.countryDialogTitle.textContent = 'Add country';
        els.slugFieldWrap.classList.remove('hidden');
        els.newSvgWrap.classList.remove('hidden');
        els.mapSlug.required = true;
        els.mapSvg.required = true;
        els.mapCountryName.value = '';
        els.mapSlug.value = '';
        els.mapTitle.value = '';
        els.mapDescription.value = '';
        els.mapLogo.value = 'images/logo-02.png';
        els.mapLogoAlt.value = 'Saikang Medical Logo';
        els.mapHue.value = '175';
        els.mapSat.value = '50%';
        els.mapMinLight.value = '75';
        els.mapMaxLight.value = '85';
    } else {
        const entry = activeEntry();
        if (!entry) return;
        els.countryDialogTitle.textContent = 'Map settings';
        els.slugFieldWrap.classList.add('hidden');
        els.newSvgWrap.classList.add('hidden');
        els.mapSlug.required = false;
        els.mapSvg.required = false;
        els.mapCountryName.value = entry.countryName || countryNameFromEntry(entry);
        els.mapTitle.value = entry.title || '';
        els.mapDescription.value = entry.description || '';
        els.mapLogo.value = entry.logoUrl || '';
        els.mapLogoAlt.value = entry.logoAlt || '';
        const colorConfig = normalizeColorConfig(entry.colorConfig);
        els.mapHue.value = colorConfig.baseHue;
        els.mapSat.value = colorConfig.sat;
        els.mapMinLight.value = colorConfig.minLight;
        els.mapMaxLight.value = colorConfig.maxLight;
        els.mapColorPicker.value = colorConfig.baseColor;
    }
    updateColorPreviewFromFields({ preservePicker: mode === 'edit' });
    els.countryDialog.showModal();
}

async function handleCountryFormSubmit(event) {
    event.preventDefault();
    try {
        if (state.countryDialogMode === 'add') {
            await createCountryFromDialog();
        } else {
            updateCountryFromDialog();
        }
        els.countryDialog.close();
    } catch (error) {
        els.countryFormMessage.textContent = error.message;
        els.countryFormMessage.className = 'notice notice-error';
    }
}

async function createCountryFromDialog() {
    const countryName = els.mapCountryName.value.trim();
    const slug = normalizeCountrySlug(els.mapSlug.value);
    if (!countryName) throw new Error('Enter a country name.');
    if (!slug) throw new Error('Enter a country slug using lowercase letters only.');
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(slug)) throw new Error('Country slug can only contain lowercase letters and hyphens.');
    if (state.catalog[slug]) throw new Error(`A map named “${slug}” already exists.`);
    const file = els.mapSvg.files?.[0];
    if (!file) throw new Error('Choose the country SVG.');
    const source = await file.text();
    const meta = parseSvgMetadata(source);
    const svgPath = `images/${slug}/${slug}.svg`;
    const entry = {
        countryName,
        title: els.mapTitle.value.trim() || `Hospital Projects in ${countryName}`,
        svgUrl: svgPath,
        logoUrl: els.mapLogo.value.trim() || 'images/logo-02.png',
        logoAlt: els.mapLogoAlt.value.trim() || 'Saikang Medical Logo',
        thumbnail: svgPath,
        description: els.mapDescription.value.trim(),
        geoBounds: { ...meta.bounds },
        colorConfig: readColorConfigFromDialog(),
        hotspots: [],
    };
    state.catalog[slug] = entry;
    state.svgSources.set(slug, source);
    state.svgMeta.set(slug, meta);
    state.stagedWrites.set(svgPath, file);
    state.activeSlug = slug;
    state.activeHotspotIndex = null;
    state.mapHotspotIndex = null;
    markDirty();
    renderCountries();
    renderWorkspace();
    renderMapPreview();
    toast(`Added ${entry.title}. You can import hotspots now or later.`);
}

function updateCountryFromDialog() {
    const entry = activeEntry();
    if (!entry) return;
    const countryName = els.mapCountryName.value.trim();
    if (!countryName) throw new Error('Country name is required.');
    entry.countryName = countryName;
    entry.title = els.mapTitle.value.trim() || `Hospital Projects in ${countryName}`;
    entry.description = els.mapDescription.value.trim();
    entry.logoUrl = els.mapLogo.value.trim();
    entry.logoAlt = els.mapLogoAlt.value.trim();
    entry.colorConfig = readColorConfigFromDialog();
    markDirty();
    renderCountries();
    renderWorkspace();
    renderMapPreview();
}

function normalizeColorConfig(config = {}) {
    const hueRaw = Number(config?.baseHue);
    const satRaw = parseFloat(String(config?.sat ?? '50').replace('%', ''));
    const minRaw = Number(config?.minLight);
    const maxRaw = Number(config?.maxLight);
    const baseHue = Number.isFinite(hueRaw) ? clamp(hueRaw, 0, 360) : 175;
    const satNumber = Number.isFinite(satRaw) ? clamp(satRaw, 0, 100) : 50;
    const minCandidate = Number.isFinite(minRaw) ? clamp(minRaw, 0, 100) : 75;
    const maxCandidate = Number.isFinite(maxRaw) ? clamp(maxRaw, 0, 100) : 85;
    const minLight = Math.min(minCandidate, maxCandidate);
    const maxLight = Math.max(minCandidate, maxCandidate);
    const supplied = /^#[0-9a-f]{6}$/i.test(String(config?.baseColor || '')) ? String(config.baseColor).toLowerCase() : '';
    const baseColor = supplied || hslToHex(baseHue, satNumber, (minLight + maxLight) / 2);
    const anchor = hexToHsl(baseColor);
    return {
        ...config,
        baseColor,
        baseHue: anchor ? round(anchor.h, 2) : baseHue,
        sat: `${round(anchor ? anchor.s : satNumber, 2)}%`,
        minLight,
        maxLight,
    };
}

function readColorConfigFromDialog() {
    const hueRaw = Number(els.mapHue.value);
    const minRaw = Number(els.mapMinLight.value);
    const maxRaw = Number(els.mapMaxLight.value);
    const hue = Number.isFinite(hueRaw) ? clamp(hueRaw, 0, 360) : 175;
    const minCandidate = Number.isFinite(minRaw) ? clamp(minRaw, 0, 100) : 75;
    const maxCandidate = Number.isFinite(maxRaw) ? clamp(maxRaw, 0, 100) : 85;
    const minLight = Math.min(minCandidate, maxCandidate);
    const maxLight = Math.max(minCandidate, maxCandidate);
    const baseColor = /^#[0-9a-f]{6}$/i.test(els.mapColorPicker.value)
        ? els.mapColorPicker.value.toLowerCase()
        : hslToHex(hue, readSaturationNumber(), (minLight + maxLight) / 2);
    return normalizeColorConfig({
        baseColor,
        baseHue: hue,
        sat: `${readSaturationNumber()}%`,
        minLight,
        maxLight,
    });
}

function readSaturationNumber() {
    const value = parseFloat(String(els.mapSat.value || '').replace('%', ''));
    return Number.isFinite(value) ? clamp(value, 0, 100) : 50;
}

function updateColorPreviewFromFields({ preservePicker = false } = {}) {
    if (!els.mapColorPreview || !els.mapColorPicker) return;
    const hue = ((Number(els.mapHue.value) || 0) % 360 + 360) % 360;
    const sat = readSaturationNumber();
    let minLight = Number(els.mapMinLight.value);
    let maxLight = Number(els.mapMaxLight.value);
    if (!Number.isFinite(minLight)) minLight = 75;
    if (!Number.isFinite(maxLight)) maxLight = 85;
    minLight = clamp(minLight, 0, 100);
    maxLight = clamp(maxLight, 0, 100);
    const low = Math.min(minLight, maxLight);
    const high = Math.max(minLight, maxLight);
    if (!preservePicker) els.mapColorPicker.value = hslToHex(hue, sat, (low + high) / 2);
    const selected = els.mapColorPicker.value.toLowerCase();
    els.mapColorPreview.style.background = selected;
    els.mapColorPreview.title = `Selected colour ${selected}`;
}

function applyColorPickerToFields() {
    const selected = String(els.mapColorPicker.value || '').toLowerCase();
    const hsl = hexToHsl(selected);
    if (!hsl) return;

    // A picked colour is exact, not merely a hue/saturation hint. Flatten the legacy
    // lightness range to the selected colour so the swatch, manager map and public map
    // all show the same colour. The advanced HSL fields can still be changed afterwards
    // if a deliberate lightness range is wanted.
    els.mapHue.value = String(round(hsl.h, 4));
    els.mapSat.value = `${round(hsl.s, 4)}%`;
    els.mapMinLight.value = String(round(hsl.l, 4));
    els.mapMaxLight.value = String(round(hsl.l, 4));
    els.mapColorPreview.style.background = selected;
    els.mapColorPreview.title = `Selected colour ${selected}`;
}

function hexToHsl(hex) {
    const match = String(hex || '').match(/^#([0-9a-f]{6})$/i);
    if (!match) return null;
    const value = parseInt(match[1], 16);
    const r = ((value >> 16) & 255) / 255;
    const g = ((value >> 8) & 255) / 255;
    const b = (value & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let sat = 0;
    if (max !== min) {
        const d = max - min;
        sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
    }
    return { h: h * 360, s: sat * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hh = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hh < 1) [r, g] = [c, x];
    else if (hh < 2) [r, g] = [x, c];
    else if (hh < 3) [g, b] = [c, x];
    else if (hh < 4) [g, b] = [x, c];
    else if (hh < 5) [r, b] = [x, c];
    else [r, b] = [c, x];
    const m = l - c / 2;
    const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}


async function handleExcelSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !state.activeSlug) return;
    try {
        if (!/\.xlsx$/i.test(file.name)) throw new Error('Please use the provided .xlsx Excel template.');
        const rows = await parseExcelFile(file);
        const parsed = parseExcelRows(rows);
        parsed.fileName = file.name;
        parsed.plan = buildImportPlan(parsed.rows, activeEntry()?.hotspots || []);
        state.pendingImport = parsed;
        renderImportDialog(parsed, file.name);
        els.importDialog.showModal();
    } catch (error) {
        console.error(error);
        toast(error.message || 'Could not import Excel file.', true);
    }
}

async function parseExcelFile(file) {
    const response = await fetch('/__manager__/excel/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'X-Manager-Token': state.apiToken },
        body: file,
    });
    if (!response.ok) {
        let message = 'Could not read the Excel workbook.';
        try { message = (await response.json()).error || message; } catch (_) { /* ignore */ }
        throw new Error(message);
    }
    const payload = await response.json();
    if (!Array.isArray(payload.rows)) throw new Error('Excel parser returned an invalid worksheet.');
    return payload.rows;
}

function parseExcelRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Excel sheet is empty.');
    const header = (rows[0] || []).map(value => String(value ?? '').trim());
    const normalized = header.map(normalizeHeader);
    const imageIndex = normalized.indexOf(normalizeHeader(EXCEL_IMAGE_HEADER));
    if (imageIndex < 0) throw new Error(`Excel template must contain an “${EXCEL_IMAGE_HEADER}” column.`);

    // The Image column can move. Locate the required template fields by header name, but only
    // accept fields that occur before Image; Image itself and everything after it is ignored.
    const columnIndexes = {};
    EXCEL_HEADERS.forEach(name => {
        const index = normalized.indexOf(normalizeHeader(name));
        if (index < 0 || index >= imageIndex) {
            throw new Error(`Excel template is missing “${name}” before the Image column.`);
        }
        columnIndexes[name] = index;
    });

    const parsedRows = [];
    const warnings = [];
    let emptyStreak = 0;
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
        const source = rows[rowIndex] || [];
        const values = Object.fromEntries(EXCEL_HEADERS.map(name => [name, String(source[columnIndexes[name]] ?? '').trim()]));
        const isEmpty = EXCEL_HEADERS.every(name => values[name] === '');
        if (isEmpty) {
            emptyStreak += 1;
            if (emptyStreak >= EMPTY_ROW_LIMIT) break;
            continue;
        }
        emptyStreak = 0;

        const record = {
            _excelRow: rowIndex + 1,
            country: values['Country'],
            city: values['City'],
            title: values['Hospital Name'],
            year: normalizeYear(values['Year']),
            address: values['Address'],
            description: values['Case Description'],
            lat: parseCoordinate(values['Latitude'], 'lat'),
            lon: parseCoordinate(values['Longitude'], 'lon'),
            images: [],
            inactiveImages: [],
        };
        if (!record.title) warnings.push({ level: 'error', text: `Row ${rowIndex + 1}: Hospital Name is empty.` });
        const coordinate = validateCoordinates(state.activeSlug, record.lat, record.lon);
        if (coordinate.level !== 'ok') warnings.push({ level: coordinate.level, text: `Row ${rowIndex + 1} (${record.title || 'unnamed'}): ${coordinate.message}` });
        const activeCountry = countryNameFromEntry(activeEntry());
        if (record.country && activeCountry && !looselySameCountry(record.country, activeCountry, state.activeSlug)) {
            warnings.push({ level: 'warning', text: `Row ${rowIndex + 1}: Country is “${record.country}”, while the selected map is “${activeCountry}”.` });
        }
        parsedRows.push(record);
    }

    if (!parsedRows.length) throw new Error('No data rows were found before five consecutive empty rows.');
    return { rows: parsedRows, warnings, sheetRowCount: rows.length, imageColumnIndex: imageIndex };
}


function renderImportDialog(parsed, fileName) {
    const counts = importPlanCounts(parsed.plan || []);
    els.importSummary.innerHTML = `
        <p><strong>${escapeHtml(fileName)}</strong>: ${parsed.rows.length} data row${parsed.rows.length === 1 ? '' : 's'} found. Image and later columns were ignored.</p>
        <div class="health-strip">
            <span class="health-pill ok">${counts.unchanged} unchanged</span>
            <span class="health-pill warning">${counts.update} updates</span>
            <span class="health-pill ok">${counts.new} new</span>
            <span class="health-pill ${counts.conflict ? 'error' : 'ok'}">${counts.conflict} conflicts</span>
        </div>
        <div class="notice notice-ok">Import stops only after ${EMPTY_ROW_LIMIT} consecutive empty rows, so isolated blank rows are safely skipped. Existing images are preserved when a hotspot is updated.</div>`;

    els.importPlan.innerHTML = '';
    (parsed.plan || []).forEach((item, planIndex) => {
        const row = document.createElement('div');
        row.className = `import-plan-row ${item.status}`;
        const badge = document.createElement('span');
        badge.className = 'plan-badge';
        badge.textContent = item.status;
        const main = document.createElement('div');
        main.className = 'import-plan-main';
        const title = document.createElement('strong');
        title.textContent = item.record.title || `Excel row ${item.record._excelRow}`;
        const sub = document.createElement('small');
        sub.textContent = [item.record.city, `row ${item.record._excelRow}`].filter(Boolean).join(' · ');
        main.append(title, sub);
        if (item.changes?.length) {
            const ul = document.createElement('ul');
            ul.className = 'import-change-list';
            item.changes.slice(0, 5).forEach(change => {
                const li = document.createElement('li');
                li.textContent = `${change.label}: ${change.before || '-'} → ${change.after || '-'}`;
                ul.appendChild(li);
            });
            if (item.changes.length > 5) {
                const li = document.createElement('li');
                li.textContent = `+${item.changes.length - 5} more change${item.changes.length - 5 === 1 ? '' : 's'}`;
                ul.appendChild(li);
            }
            main.appendChild(ul);
        }
        row.append(badge, main);
        if (item.status === 'conflict') {
            const select = document.createElement('select');
            select.dataset.planIndex = String(planIndex);
            select.innerHTML = '<option value="">Choose match…</option><option value="new">Add as new hotspot</option>';
            item.candidates.forEach(index => {
                const h = activeEntry()?.hotspots?.[index];
                if (!h) return;
                const option = document.createElement('option');
                option.value = String(index);
                option.textContent = `${h.title || 'Unnamed'}${h.city ? ` - ${h.city}` : ''}`;
                select.appendChild(option);
            });
            select.addEventListener('change', updateImportConfirmState);
            row.appendChild(select);
            initializeCustomSelects(row);
        } else {
            const action = document.createElement('small');
            action.className = 'muted';
            action.textContent = item.status === 'update' ? 'Will merge' : item.status === 'new' ? 'Will add' : 'No changes';
            row.appendChild(action);
        }
        els.importPlan.appendChild(row);
    });

    els.importWarnings.innerHTML = '';
    if (!parsed.warnings.length) {
        els.importWarnings.innerHTML = '<div class="validation-item ok">No template/coordinate warnings.</div>';
    } else {
        parsed.warnings.forEach(issue => appendValidationItem(els.importWarnings, issue));
    }
    updateImportConfirmState();
}


async function confirmExcelImport() {
    const pending = state.pendingImport;
    const entry = activeEntry();
    if (!pending || !entry) return;
    const unresolved = [...els.importPlan.querySelectorAll('select[data-plan-index]')].filter(select => !select.value);
    if (unresolved.length) {
        toast(`Resolve ${unresolved.length} import conflict${unresolved.length === 1 ? '' : 's'} first.`, true);
        unresolved[0].closest('.custom-select')?.querySelector('.custom-select-button')?.focus();
        return;
    }

    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let conflicts = 0;
    for (let planIndex = 0; planIndex < pending.plan.length; planIndex++) {
        const item = pending.plan[planIndex];
        const record = item.record;
        let targetIndex = item.targetIndex;
        if (item.status === 'conflict') {
            conflicts++;
            const select = els.importPlan.querySelector(`select[data-plan-index="${planIndex}"]`);
            if (!select || !select.value) continue;
            targetIndex = select.value === 'new' ? -1 : Number(select.value);
        }

        if (item.status === 'unchanged' && targetIndex >= 0) {
            unchanged++;
            continue;
        }

        let hotspot;
        if (targetIndex >= 0 && entry.hotspots[targetIndex]) {
            hotspot = entry.hotspots[targetIndex];
            applyImportedRecord(hotspot, record);
            updated++;
        } else {
            hotspot = {
                ...record,
                provinceId: '',
                x: NaN,
                y: NaN,
                images: [],
                inactiveImages: [],
                _assetFolder: '',
            };
            entry.hotspots.push(hotspot);
            targetIndex = entry.hotspots.length - 1;
            added++;
        }

        const coordinate = validateCoordinates(state.activeSlug, hotspot.lat, hotspot.lon);
        if (coordinate.level !== 'error') syncHotspotFromCoordinates(hotspot, { redetectProvince: !hotspot.provinceId });
        if (!allManagedImages(hotspot).length) hotspot._assetFolder = generatedFacilityFolder(hotspot, state.activeSlug);
        if (!hotspot._baselinePosition) captureHotspotBaseline(hotspot);
        hotspot._importedFromExcel = true;
        hotspot._importedSession = true;
        hotspot._excelRow = record._excelRow;
        hotspot._importConflict = item.status === 'conflict';
    }

    const historyItem = {
        slug: state.activeSlug,
        fileName: pending.fileName || 'Excel import',
        when: new Date(),
        added,
        updated,
        unchanged,
        conflicts,
        warnings: pending.warnings.length,
        saved: false,
    };
    state.importHistory.unshift(historyItem);
    state.importHistory = state.importHistory.slice(0, 20);

    markDirty();
    els.importDialog.close();
    state.pendingImport = null;
    renderMapPreview();
    await nextFrame();
    entry.hotspots.forEach(h => {
        const coordinate = validateCoordinates(state.activeSlug, h.lat, h.lon);
        if (coordinate.level !== 'error' && Number.isFinite(Number(h.x)) && Number.isFinite(Number(h.y))) {
            const detectedProvince = detectProvinceAtXY(h.x, h.y);
            if (!h.provinceId) h.provinceId = detectedProvince || '';
            h._provinceOverride = Boolean(h.provinceId);
            refreshProvinceMismatch(h, detectedProvince);
        }
    });
    renderHotspotList();
    renderEditor();
    renderCountryHealth();
    renderCountries();
    renderImportHistory();
    updatePreviewMarkers();
    toast(`Excel merge complete: ${added} new, ${updated} updated, ${unchanged} unchanged.`);
}


function buildImportPlan(records, hotspots) {
    return records.map(record => {
        const titleKey = normalizedText(record.title);
        const cityKey = normalizedText(record.city);
        const exactTitle = hotspots
            .map((h, index) => ({ h, index }))
            .filter(({ h }) => normalizedText(h.title) === titleKey && titleKey);
        const exactCity = cityKey
            ? exactTitle.filter(({ h }) => normalizedText(h.city) === cityKey)
            : [];

        let candidates = [];
        if (exactCity.length === 1) candidates = exactCity;
        else if (exactCity.length > 1) candidates = exactCity;
        else if (exactTitle.length === 1) candidates = exactTitle;
        else if (exactTitle.length > 1) candidates = exactTitle;

        if (!candidates.length) {
            const scored = hotspots
                .map((h, index) => {
                    const similarity = textSimilarity(record.title, h.title);
                    const distance = Number.isFinite(Number(record.lat)) && Number.isFinite(Number(record.lon)) && Number.isFinite(Number(h.lat)) && Number.isFinite(Number(h.lon))
                        ? haversineMeters(record.lat, record.lon, h.lat, h.lon)
                        : Infinity;
                    return { h, index, similarity, distance };
                })
                .filter(item => item.similarity >= 0.88 || (item.similarity >= 0.62 && item.distance <= 1500))
                .sort((a, b) => (b.similarity - a.similarity) || (a.distance - b.distance));
            if (scored.length) {
                const best = scored[0];
                const close = scored.filter(item => item.similarity >= best.similarity - 0.035 && item.distance <= Math.max(best.distance * 1.5, 2000));
                candidates = close.length ? close : [best];
                return {
                    record,
                    status: 'conflict',
                    targetIndex: -1,
                    candidates: candidates.map(item => item.index),
                    changes: [],
                };
            }
            return { record, status: 'new', targetIndex: -1, candidates: [], changes: [] };
        }

        if (candidates.length > 1) {
            return {
                record,
                status: 'conflict',
                targetIndex: -1,
                candidates: candidates.map(item => item.index),
                changes: [],
            };
        }
        const targetIndex = candidates[0].index;
        const changes = importedChanges(hotspots[targetIndex], record);
        return {
            record,
            status: changes.length ? 'update' : 'unchanged',
            targetIndex,
            candidates: [targetIndex],
            changes,
        };
    });
}

function importedChanges(existing, record) {
    const fields = [
        ['title', 'Facility'],
        ['city', 'City / region'],
        ['year', 'Year'],
        ['address', 'Address'],
        ['description', 'Description'],
        ['lat', 'Latitude'],
        ['lon', 'Longitude'],
    ];
    const changes = [];
    fields.forEach(([key, label]) => {
        const incoming = record[key];
        const optional = ['city', 'year', 'address', 'description'].includes(key);
        if (optional && String(incoming ?? '').trim() === '') return;
        const before = existing?.[key];
        const same = key === 'lat' || key === 'lon'
            ? Number.isFinite(Number(before)) && Number.isFinite(Number(incoming)) && Math.abs(Number(before) - Number(incoming)) < 1e-7
            : normalizedText(before) === normalizedText(incoming);
        if (!same) changes.push({ key, label, before: String(before ?? ''), after: String(incoming ?? '') });
    });
    return changes;
}

function applyImportedRecord(target, record) {
    const preservedImages = target.images || [];
    const preservedInactiveImages = target.inactiveImages || [];
    const preservedFolder = allManagedImages(target).length ? target._assetFolder : '';
    const required = ['title', 'lat', 'lon'];
    required.forEach(key => { target[key] = record[key]; });
    ['country', 'city', 'year', 'address', 'description'].forEach(key => {
        if (String(record[key] ?? '').trim() !== '') target[key] = record[key];
    });
    target.images = preservedImages;
    target.inactiveImages = preservedInactiveImages;
    target._assetFolder = preservedFolder || inferAssetFolder(target, state.activeSlug) || generatedFacilityFolder(target, state.activeSlug);
}

function importPlanCounts(plan) {
    return plan.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
    }, { new: 0, update: 0, unchanged: 0, conflict: 0 });
}

function updateImportConfirmState() {
    const unresolved = [...els.importPlan.querySelectorAll('select[data-plan-index]')].filter(select => !select.value).length;
    els.confirmImport.disabled = unresolved > 0;
    els.confirmImport.textContent = unresolved ? `Resolve ${unresolved} conflict${unresolved === 1 ? '' : 's'}` : 'Apply Import';
}

function renderImportHistory() {
    if (!els.importHistory || !state.activeSlug) return;
    const items = state.importHistory.filter(item => item.slug === state.activeSlug).slice(0, 5);
    if (!items.length) {
        els.importHistory.classList.add('hidden');
        els.importHistory.innerHTML = '';
        return;
    }
    els.importHistory.classList.remove('hidden');
    els.importHistory.innerHTML = '<div class="import-history-heading"><strong>Import history · this session</strong><span class="muted">Latest first</span></div><div class="import-history-list"></div>';
    const list = els.importHistory.querySelector('.import-history-list');
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'import-history-item';
        const time = item.when instanceof Date ? item.when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        div.innerHTML = `<b>${escapeHtml(item.fileName)}</b> · ${time} · +${item.added} new · ${item.updated} updated · ${item.unchanged} unchanged${item.conflicts ? ` · ${item.conflicts} reviewed` : ''}`;
        list.appendChild(div);
    });
}

function parseCoordinate(value, axis) {
    if (value == null || value === '') return NaN;
    if (typeof value === 'number') return value;
    let text = String(value).trim().toUpperCase();
    if (!text) return NaN;
    const direction = (text.match(/[NSEW]/) || [])[0] || '';
    text = text.replace(/[^0-9+\-.,]/g, '');
    if (text.includes(',') && !text.includes('.')) text = text.replace(',', '.');
    else text = text.replace(/,/g, '');
    const numeric = parseFloat(text);
    if (!Number.isFinite(numeric)) return NaN;
    let result = numeric;
    if (direction === 'S' || direction === 'W') result = -Math.abs(numeric);
    if (direction === 'N' || direction === 'E') result = Math.abs(numeric);
    if (axis === 'lat' && Math.abs(result) > 180) return NaN;
    if (axis === 'lon' && Math.abs(result) > 180) return NaN;
    return result;
}

function validateCoordinates(slug, lat, lon) {
    const a = Number(lat);
    const o = Number(lon);
    if (!Number.isFinite(a) || !Number.isFinite(o)) {
        return { level: 'error', message: 'Latitude or longitude is missing/invalid.', suggestSwap: false };
    }
    const latRange = a >= -90 && a <= 90;
    const lonRange = o >= -180 && o <= 180;
    const swappedRange = o >= -90 && o <= 90 && a >= -180 && a <= 180;
    const bounds = state.svgMeta.get(slug)?.bounds || state.catalog?.[slug]?.geoBounds;
    const inside = bounds ? pointInsideBounds(a, o, bounds) : latRange && lonRange;
    const swappedInside = bounds ? pointInsideBounds(o, a, bounds) : swappedRange;

    if (!latRange || !lonRange) {
        if (swappedRange && swappedInside) {
            return { level: 'error', message: 'Latitude/longitude appear to be swapped. The swapped pair fits this country.', suggestSwap: true };
        }
        return { level: 'error', message: 'Coordinates are outside valid latitude/longitude ranges.', suggestSwap: false };
    }
    if (bounds && !inside) {
        if (swappedInside) {
            return { level: 'warning', message: 'Coordinates are outside this map, but the swapped pair falls inside it.', suggestSwap: true };
        }
        return { level: 'error', message: 'Coordinates fall outside the SVG geographic bounds.', suggestSwap: false };
    }
    if (bounds && inside && swappedInside && Math.abs(a - o) > 1e-9) {
        return { level: 'warning', message: 'Coordinates are valid, but the swapped pair is also plausible. Please verify the marker.', suggestSwap: false };
    }
    return { level: 'ok', message: 'Coordinates are valid for this map.', suggestSwap: false };
}

function pointInsideBounds(lat, lon, bounds) {
    return lat >= bounds.minLat && lat <= bounds.maxLat && lon >= bounds.minLon && lon <= bounds.maxLon;
}

function currentHotspotIssues(slug, h, index = null) {
    const live = validateHotspot(slug, h, { index });
    if (!Number.isInteger(index)) return live;
    const cachedDeep = (state.deepValidationIssues.get(slug) || [])
        .filter(issue => issue.hotspotIndex === index)
        .map(issue => ({ ...issue, text: issue.hotspotText || issue.text }));
    return dedupeIssues([...live, ...cachedDeep]);
}

function hotspotValidationStatus(slug, h, index = null) {
    const issues = currentHotspotIssues(slug, h, index);
    if (issues.some(i => i.level === 'error')) return { level: 'error', label: 'Invalid' };
    if (issues.some(i => i.level === 'warning')) return { level: 'warning', label: 'Needs review' };
    return { level: 'ok', label: 'Valid' };
}

const OUTSIDE_ASSIGNED_REGION = '__outside_assigned_region__';

function refreshProvinceMismatch(h, detectedProvince = undefined) {
    if (!h || !h.provinceId || !Number.isFinite(Number(h.x)) || !Number.isFinite(Number(h.y))) {
        if (h) h._provinceMismatch = '';
        return '';
    }
    const detected = detectedProvince === undefined ? detectProvinceAtXY(h.x, h.y) : detectedProvince;
    h._provinceMismatch = detected === h.provinceId ? '' : (detected || OUTSIDE_ASSIGNED_REGION);
    return h._provinceMismatch;
}

function provinceDisplayName(slug, provinceId) {
    const id = String(provinceId || '').trim();
    if (!id) return 'unassigned';
    if (id === OUTSIDE_ASSIGNED_REGION) return 'outside any province/state';
    const region = state.svgMeta.get(slug)?.regions?.find(item => item.id === id);
    return region?.name && region.name !== id ? `${region.name} (${id})` : id;
}

function provinceMismatchText(slug, h) {
    const assigned = provinceDisplayName(slug, h.provinceId);
    if (h._provinceMismatch === OUTSIDE_ASSIGNED_REGION) return `Coordinates do not fall inside assigned ${assigned}.`;
    const detected = provinceDisplayName(slug, h._provinceMismatch);
    return `Coordinates fall in ${detected}; assigned to ${assigned}.`;
}

function validateHotspot(slug, h, { index = null } = {}) {
    const issues = [];
    if (!String(h.title || '').trim()) issues.push({ level: 'error', target: 'title', text: 'Facility name is missing.' });
    const coordinate = validateCoordinates(slug, h.lat, h.lon);
    if (coordinate.level !== 'ok') issues.push({ level: coordinate.level, target: 'coordinates', text: coordinate.message });
    if (!Number.isFinite(Number(h.x)) || !Number.isFinite(Number(h.y))) issues.push({ level: 'error', target: 'coordinates', text: 'Map position is missing.' });
    const meta = state.svgMeta.get(slug);
    if (!h.provinceId) issues.push({ level: 'error', target: 'province', text: 'Province/state is required.' });
    else if (meta && !meta.regions.some(r => r.id === h.provinceId)) issues.push({ level: 'error', target: 'province', text: `Province/state ${h.provinceId} is not in the current SVG.` });

    if (!h.images?.length) issues.push({ level: 'warning', target: 'images', text: h.inactiveImages?.length ? 'No images are enabled for the public map.' : 'No images added.' });
    if (h._importConflict) issues.push({ level: 'warning', target: 'general', text: 'Excel match was resolved manually.' });
    if (h._provinceMismatch) issues.push({ level: 'warning', target: 'province', text: provinceMismatchText(slug, h) });

    for (const path of h.images || []) {
        const stat = state.fileStats.get(path);
        const optimized = state.imageOptimizationMeta.get(path);
        const size = optimized?.finalBytes ?? stat?.size;
        if (Number.isFinite(size) && size > OVERSIZED_IMAGE_BYTES) {
            issues.push({ level: 'warning', target: 'images', text: `${path.split('/').pop()} is ${formatBytes(size)}; preferred max is 4 MB.` });
        }
    }

    const entry = state.catalog?.[slug];
    if (entry && index != null) {
        entry.hotspots.forEach((other, otherIndex) => {
            if (otherIndex === index) return;
            const sameName = normalizedText(other.title) && normalizedText(other.title) === normalizedText(h.title);
            const sameCity = normalizedText(other.city) && normalizedText(other.city) === normalizedText(h.city);
            if (sameName && (sameCity || !normalizedText(h.city) || !normalizedText(other.city))) {
                const names = [h.title || `Hotspot ${index + 1}`, other.title || `Hotspot ${otherIndex + 1}`].sort((a, b) => a.localeCompare(b));
                issues.push({ level: 'warning', target: 'title', text: `Possible duplicate: “${names[0]}” / “${names[1]}”.` });
            }
        });
    }
    return dedupeIssues(issues);
}

function validateCountry(slug) {
    const entry = state.catalog[slug];
    const meta = state.svgMeta.get(slug);
    const issues = [];
    if (!String(entry.countryName || '').trim()) issues.push({ level: 'error', target: 'countryName', text: 'Country name is missing.' });
    if (!entry.title) issues.push({ level: 'error', target: 'mapTitle', text: 'Public map title is missing.' });
    if (!entry.svgUrl) issues.push({ level: 'error', target: 'mapSvg', text: 'SVG path is missing.' });
    if (!meta) issues.push({ level: 'error', target: 'mapSvg', text: 'SVG has not been loaded.' });
    else {
        if (!meta.regions.length) issues.push({ level: 'error', target: 'mapSvg', text: 'No province/state IDs found in the SVG.' });
        if (meta.duplicateRegionIds?.length) {
            const sample = meta.duplicateRegionIds.slice(0, 5).join(', ');
            const remaining = meta.duplicateRegionIds.length - Math.min(meta.duplicateRegionIds.length, 5);
            issues.push({
                level: 'error',
                target: 'mapSvg',
                text: `SVG region IDs must be unique. Duplicate ID${meta.duplicateRegionIds.length === 1 ? '' : 's'}: ${sample}${remaining ? ` +${remaining} more` : ''}.`,
            });
        }
        if (!entry.geoBounds) issues.push({ level: 'error', target: 'mapSvg', text: 'Geographic bounds are missing.' });
        const unresolvedCodes = unresolvedRegionCountryCodes(slug);
        if (unresolvedCodes.length) {
            const sample = unresolvedCodes.slice(0, 4).map(region => region.id).join(', ');
            const remaining = unresolvedCodes.length - Math.min(unresolvedCodes.length, 4);
            issues.push({
                level: 'warning',
                target: 'regionCodes',
                text: `Country Codes need metadata for ${unresolvedCodes.length} SVG region${unresolvedCodes.length === 1 ? '' : 's'} (${sample}${remaining ? ` +${remaining} more` : ''}). Add data-code/data-abbr/data-label to the SVG or a country entry in manager/region-metadata.js.`,
            });
        }
    }
    if (!entry.hotspots.length) issues.push({ level: 'warning', target: 'hotspots', text: 'No hotspots yet.' });
    entry.hotspots.forEach((h, index) => {
        validateHotspot(slug, h, { index }).forEach(issue => issues.push({ ...issue, hotspotIndex: index, text: `${h.title || `Hotspot ${index + 1}`}: ${issue.text}` }));
    });
    return dedupeIssues(issues);
}

async function hydrateImageStatsForCountry(slug) {
    const entry = state.catalog?.[slug];
    if (!entry) return;
    const paths = [...new Set(entry.hotspots.flatMap(h => allManagedImages(h)))];
    await Promise.all(paths.map(async path => {
        if (state.stagedWrites.has(path)) {
            const data = state.stagedWrites.get(path);
            const blob = typeof data === 'string' ? new Blob([data]) : data;
            const size = blob?.size;
            let sha256 = '';
            try {
                const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
                sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
            } catch (_) { /* hashing is validation-only; size is still useful */ }
            if (Number.isFinite(size)) state.fileStats.set(path, { exists: true, size, sha256 });
            return;
        }
        try {
            const stat = await getFileStat(path, true);
            state.fileStats.set(path, stat);
        } catch (_) {
            state.fileStats.set(path, { exists: false, size: NaN });
        }
    }));
}

async function validateCountryDeep(slug) {
    const entry = state.catalog[slug];
    const referencedImages = new Map();

    entry.hotspots.forEach(h => {
        if (Number.isFinite(Number(h.x)) && Number.isFinite(Number(h.y)) && h.provinceId) {
            refreshProvinceMismatch(h);
        }
    });

    const issues = validateCountry(slug);
    entry.hotspots.forEach((h, index) => {
        for (const path of allManagedImages(h)) {
            const isInactive = (h.inactiveImages || []).includes(path);
            if (!referencedImages.has(path)) referencedImages.set(path, []);
            referencedImages.get(path).push(`${h.title || `Hotspot ${index + 1}`}${isInactive ? ' (unused)' : ''}`);
            const stat = state.fileStats.get(path);
            if (state.stagedDeletes.has(path)) {
                issues.push({ level: 'error', target: 'images', deep: true, hotspotIndex: index, hotspotText: `Image staged for deletion - ${path.split('/').pop()}.`, text: `${h.title || `Hotspot ${index + 1}`}: image staged for deletion - ${path.split('/').pop()}.` });
            } else if (stat && stat.exists === false && !state.stagedWrites.has(path)) {
                issues.push({ level: 'error', target: 'images', deep: true, hotspotIndex: index, hotspotText: `Missing image - ${path.split('/').pop()}.`, text: `${h.title || `Hotspot ${index + 1}`}: missing image - ${path.split('/').pop()}.` });
            }
        }
    });

    for (const [path, owners] of referencedImages) {
        if (owners.length > 1) issues.push({ level: 'warning', target: 'images', deep: true, text: `Image is referenced by multiple hotspots (${owners.join(', ')}): ${path}.` });
    }

    const hashes = new Map();
    for (const path of referencedImages.keys()) {
        const hash = state.fileStats.get(path)?.sha256;
        if (!hash) continue;
        if (!hashes.has(hash)) hashes.set(hash, []);
        hashes.get(hash).push(path);
    }
    for (const paths of hashes.values()) {
        if (paths.length > 1) issues.push({ level: 'warning', target: 'images', deep: true, text: `Duplicate image content: ${paths.map(path => path.split('/').pop()).join(', ')}.` });
    }

    for (let i = 0; i < entry.hotspots.length; i++) {
        for (let j = i + 1; j < entry.hotspots.length; j++) {
            const a = entry.hotspots[i];
            const b = entry.hotspots[j];
            const similarity = textSimilarity(a.title, b.title);
            if (similarity >= 0.92 && normalizedText(a.title) !== normalizedText(b.title)) {
                issues.push({ level: 'warning', target: 'title', deep: true, hotspotIndex: i, hotspotText: `Possible duplicate: “${a.title || `Hotspot ${i + 1}`}” / “${b.title || `Hotspot ${j + 1}`}”.`, text: `Possible duplicate: “${a.title || `Hotspot ${i + 1}`}” / “${b.title || `Hotspot ${j + 1}`}”.` });
            }
        }
    }

    try {
        const files = await listPath(`images/${slug}`);
        const keep = new Set([...referencedImages.keys(), entry.svgUrl, entry.logoUrl, entry.thumbnail].filter(Boolean));
        const imageExt = /\.(?:jpe?g|png|webp|gif|avif|bmp)$/i;
        const unused = files.filter(file => imageExt.test(file.path) && !keep.has(file.path) && !state.stagedDeletes.has(file.path));
        if (unused.length) {
            const total = unused.reduce((sum, file) => sum + Number(file.size || 0), 0);
            issues.push({ level: 'warning', target: 'images', deep: true, text: `${unused.length} unused image file${unused.length === 1 ? '' : 's'} (${formatBytes(total)}). Review with “Find unused images”.` });
        }
    } catch (error) {
        issues.push({ level: 'warning', target: 'images', deep: true, text: `Could not scan image folder: ${error.message}` });
    }
    const deduped = dedupeIssues(issues);
    state.deepValidationIssues.set(slug, deduped.filter(issue => issue.deep));
    return deduped;
}

async function validateEverything() {
    const all = [];
    const previousSlug = state.activeSlug;
    const previousIndex = state.activeHotspotIndex;
    const previousMapIndex = state.mapHotspotIndex;
    const previousBase = state.previewBaseView ? { ...state.previewBaseView } : null;
    const previousView = state.previewView ? { ...state.previewView } : null;

    for (const slug of Object.keys(state.catalog)) {
        try {
            state.activeSlug = slug;
            state.activeHotspotIndex = null;
            state.mapHotspotIndex = null;
            await ensureSvgLoaded(slug);
            backfillGeographicCoordinates(slug);
            renderMapPreview();
            await nextFrame();
            await hydrateImageStatsForCountry(slug);
            const issues = await validateCountryDeep(slug);
            issues.forEach(issue => all.push({ slug, ...issue }));
        } catch (error) {
            all.push({ slug, level: 'error', text: error.message });
        }
    }

    state.activeSlug = previousSlug;
    state.activeHotspotIndex = previousIndex;
    state.mapHotspotIndex = previousMapIndex;
    state.previewBaseView = previousBase;
    state.previewView = previousView;
    if (previousSlug && state.svgSources.has(previousSlug)) {
        renderWorkspace();
        renderMapPreview();
        await nextFrame();
        if (previousView) { state.previewView = previousView; applyPreviewViewBox(); }
    } else {
        renderWorkspace();
    }
    renderCountries();
    return dedupeIssues(all.map(issue => ({ ...issue, text: issue.text })));
}

async function runValidationDialog() {
    try {
        els.validationDialogTitle.textContent = 'Issues';
        els.validationSummary.innerHTML = '<p class="muted">Checking project issues…</p>';
        els.validationResults.innerHTML = '';
        if (els.validationScrollRegion) els.validationScrollRegion.scrollTop = 0;
        els.validationDialog.showModal();
        const issues = await validateEverything();
        renderValidationResults(issues, { scope: 'global' });
    } catch (error) {
        console.error(error);
        els.validationSummary.innerHTML = `<div class="notice notice-error">${escapeHtml(error.message)}</div>`;
    }
}

async function runCountryValidationDialog() {
    const slug = state.activeSlug;
    if (!slug) return;
    try {
        const entry = state.catalog[slug];
        els.validationDialogTitle.textContent = `Validate ${entry.countryName || countryNameFromEntry(entry) || slug}`;
        els.validationSummary.innerHTML = '<p class="muted">Checking this country…</p>';
        els.validationResults.innerHTML = '';
        if (els.validationScrollRegion) els.validationScrollRegion.scrollTop = 0;
        els.validationDialog.showModal();
        await ensureSvgLoaded(slug);
        backfillGeographicCoordinates(slug);
        renderMapPreview();
        await nextFrame();
        await hydrateImageStatsForCountry(slug);
        const issues = (await validateCountryDeep(slug)).map(issue => ({ slug, ...issue }));
        renderValidationResults(issues, { scope: 'country', slug });
        renderCountryHealth();
        renderCountries();
        updatePreviewMarkers();
    } catch (error) {
        console.error(error);
        els.validationSummary.innerHTML = `<div class="notice notice-error">${escapeHtml(error.message)}</div>`;
    }
}

function renderValidationResults(issues, { scope = 'global', slug = null } = {}) {
    const relevant = issues.filter(issue => issue.level === 'error' || issue.level === 'warning');
    const errors = relevant.filter(issue => issue.level === 'error').length;
    const warnings = relevant.filter(issue => issue.level === 'warning').length;
    const affectedCountries = new Set(relevant.map(issue => issue.slug).filter(Boolean)).size;
    const summaryBits = [];
    if (errors) summaryBits.push(`${errors} blocking`);
    if (warnings) summaryBits.push(`${warnings} to review`);
    const summaryText = summaryBits.length ? summaryBits.join(' · ') : 'No issues found';
    const scopeText = scope === 'global' && affectedCountries
        ? `${affectedCountries} countr${affectedCountries === 1 ? 'y' : 'ies'} affected`
        : 'Current country';
    els.validationSummary.innerHTML = `<div class="issues-summary ${errors ? 'error' : warnings ? 'warning' : 'ok'}"><i></i><div><strong>${escapeHtml(summaryText)}</strong><span>${escapeHtml(scopeText)}</span></div></div>`;
    els.validationResults.innerHTML = '';
    if (els.validationScrollRegion) els.validationScrollRegion.scrollTop = 0;

    if (scope === 'global') {
        els.validationFilters.classList.remove('hidden');
        const counts = { all: relevant.length, error: errors, warning: warnings };
        els.validationFilters.querySelectorAll('[data-issue-filter]').forEach(button => {
            const filter = button.dataset.issueFilter;
            const label = filter === 'all' ? 'All' : filter === 'error' ? 'Blocking' : 'Review';
            button.textContent = `${label} ${counts[filter]}`;
            button.classList.toggle('active', filter === 'all');
            button.onclick = () => applyValidationFilter(filter);
        });
    } else {
        els.validationFilters.classList.add('hidden');
    }

    if (!relevant.length) {
        appendValidationItem(els.validationResults, { level: 'ok', text: scope === 'global' ? 'Project is clear.' : 'This country is clear.' });
        if (scope === 'global') setIssuesButtonState('ok', 0, 'No known issues');
        else updateIssuesButton();
        return;
    }

    if (scope === 'global') {
        const grouped = new Map();
        relevant.forEach(issue => {
            const key = issue.slug || 'project';
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(issue);
        });
        grouped.forEach((groupIssues, groupSlug) => {
            const section = document.createElement('section');
            section.className = 'validation-country-group';
            section.dataset.issueGroup = groupSlug;
            const heading = document.createElement('button');
            heading.type = 'button';
            heading.className = 'validation-country-heading';
            const entry = state.catalog[groupSlug];
            const name = entry?.countryName || countryNameFromEntry(entry) || groupSlug;
            const groupErrors = groupIssues.filter(issue => issue.level === 'error').length;
            const groupWarnings = groupIssues.length - groupErrors;
            heading.innerHTML = `<strong>${escapeHtml(name)}</strong><span>${groupErrors ? `${groupErrors} blocking` : ''}${groupErrors && groupWarnings ? ' · ' : ''}${groupWarnings ? `${groupWarnings} review` : ''}</span>`;
            if (state.catalog[groupSlug]) heading.addEventListener('click', () => openIssueTarget({ slug: groupSlug }));
            section.appendChild(heading);
            groupIssues.forEach(issue => appendValidationItem(section, issue));
            els.validationResults.appendChild(section);
        });
        setIssuesButtonState(errors ? 'error' : 'warning', errors + warnings, summaryText);
    } else {
        relevant.forEach(issue => appendValidationItem(els.validationResults, issue));
        updateIssuesButton();
    }
}

function applyValidationFilter(filter) {
    const wanted = ['all', 'error', 'warning'].includes(filter) ? filter : 'all';
    els.validationFilters.querySelectorAll('[data-issue-filter]').forEach(button => {
        button.classList.toggle('active', button.dataset.issueFilter === wanted);
    });
    els.validationResults.querySelectorAll('.validation-item[data-level]').forEach(item => {
        item.classList.toggle('hidden', wanted !== 'all' && item.dataset.level !== wanted);
    });
    els.validationResults.querySelectorAll('.validation-country-group').forEach(group => {
        const visible = [...group.querySelectorAll('.validation-item[data-level]')].some(item => !item.classList.contains('hidden'));
        group.classList.toggle('hidden', !visible);
    });

    els.validationScrollRegion?.querySelector('.validation-filter-empty')?.remove();
    const visibleItems = [...els.validationResults.querySelectorAll('.validation-item[data-level]')]
        .filter(item => !item.classList.contains('hidden'));
    if (!visibleItems.length && wanted !== 'all' && els.validationScrollRegion) {
        const empty = document.createElement('div');
        empty.className = 'empty-state compact validation-filter-empty';
        empty.textContent = wanted === 'error' ? 'No blocking issues.' : 'No review issues.';
        els.validationScrollRegion.appendChild(empty);
    }
    if (els.validationScrollRegion) els.validationScrollRegion.scrollTop = 0;
}

async function openIssueTarget(issue) {
    if (!issue?.slug || !state.catalog?.[issue.slug]) return;
    els.validationDialog.close();
    if (issue.slug !== state.activeSlug) {
        await selectCountry(issue.slug);
        if (state.activeSlug !== issue.slug) return;
    }

    if (Number.isInteger(issue.hotspotIndex) && state.catalog[issue.slug]?.hotspots?.[issue.hotspotIndex]) {
        const visible = getFilteredHotspots().some(item => item.index === issue.hotspotIndex);
        if (!visible) {
            els.hotspotSearch.value = '';
            els.hotspotFilter.value = 'all';
            refreshCustomSelect(els.hotspotFilter);
        }
        selectHotspot(issue.hotspotIndex, { revealInList: true });
        await nextFrame();
        focusHotspotIssueTarget(issue.target || 'general');
        return;
    }

    focusCountryIssueTarget(issue.target || 'general');
}

function issueFocusElement(element) {
    if (!element) return null;
    if (element.matches?.('select.native-select-hidden')) {
        return element.closest('.custom-select')?.querySelector('.custom-select-button') || element;
    }
    return element;
}

function revealIssueTarget(element, { focus = true } = {}) {
    const target = issueFocusElement(element);
    if (!target) return;
    const highlight = target.closest?.('.field, .coordinate-card, .images-section, .panel, .country-header') || target;
    highlight.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    highlight.classList.remove('issue-target-flash');
    // Restart the animation even when the same issue is opened twice in succession.
    void highlight.offsetWidth;
    highlight.classList.add('issue-target-flash');
    window.setTimeout(() => highlight.classList.remove('issue-target-flash'), 1800);
    if (focus && typeof target.focus === 'function') {
        window.setTimeout(() => target.focus({ preventScroll: true }), 180);
    }
}

function focusHotspotIssueTarget(target) {
    const targets = {
        title: els.fieldTitle,
        coordinates: els.hotspotEditor?.querySelector('.coordinate-card'),
        province: els.fieldProvince,
        images: els.hotspotEditor?.querySelector('.images-section'),
        general: els.hotspotEditor?.querySelector('.editor-heading'),
    };
    revealIssueTarget(targets[target] || targets.general, { focus: target !== 'images' && target !== 'general' });
}

function focusCountryIssueTarget(target) {
    if (target === 'hotspots') {
        revealIssueTarget(els.addHotspot);
        return;
    }
    if (target === 'regionCodes') {
        setRegionLabelMode('codes');
        revealIssueTarget(els.mapLabelMode);
        return;
    }
    if (target === 'mapSvg') {
        els.replaceSvg?.closest('details')?.setAttribute('open', '');
        revealIssueTarget(els.replaceSvg);
        return;
    }
    if (target === 'images') {
        els.cleanupUnusedImages?.closest('details')?.setAttribute('open', '');
        revealIssueTarget(els.cleanupUnusedImages);
        return;
    }
    if (target === 'countryName' || target === 'mapTitle') {
        openCountryDialog('edit');
        window.setTimeout(() => revealIssueTarget(target === 'countryName' ? els.mapCountryName : els.mapTitle), 0);
        return;
    }
    revealIssueTarget(els.countryWorkspace, { focus: false });
}

function renderCountryHealth() {
    const entry = activeEntry();
    if (!entry) return;
    const stats = getCountryStats(state.activeSlug);
    const imageCount = stats.images;
    const meta = state.svgMeta.get(state.activeSlug);
    const overall = stats.errors ? 'error' : stats.warnings ? 'warning' : 'ok';
    const overallLabel = stats.errors ? 'Action required' : stats.warnings ? 'Needs review' : 'Ready';
    const overallDetail = stats.errors
        ? `${stats.errors} blocking issue${stats.errors === 1 ? '' : 's'}`
        : stats.warnings
            ? `${stats.warnings} review issue${stats.warnings === 1 ? '' : 's'}`
            : 'No issues found';
    els.countryHealth.innerHTML = `
        <div class="overview-status ${overall}">
            <i></i><div><strong>${overallLabel}</strong><span>${overallDetail}</span></div>
        </div>
        <div class="overview-metrics">
            <div><strong>${entry.hotspots.length}</strong><span>Hotspots</span></div>
            <div><strong>${imageCount}</strong><span>Photos</span></div>
            <div><strong>${stats.valid}</strong><span>Valid</span></div>
            <div><strong>${meta?.regions?.length || 0}</strong><span>Map regions</span></div>
        </div>`;
}

function appendValidationItem(container, issue) {
    const div = document.createElement(issue.slug ? 'button' : 'div');
    if (issue.slug) div.type = 'button';
    div.className = `validation-item ${issue.level}${issue.slug ? ' clickable' : ''}`;
    div.dataset.level = issue.level;
    const icon = document.createElement('i');
    icon.className = 'validation-item-dot';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = issue.text;
    div.append(icon, text);
    if (issue.slug) {
        div.title = Number.isInteger(issue.hotspotIndex) ? 'Open this hotspot' : 'Open this country';
        div.addEventListener('click', () => openIssueTarget(issue));
    }
    container.appendChild(div);
}


async function addImagesToSelected(files) {
    const h = activeHotspot();
    if (!h || !files.length) return;
    h.images = h.images || [];

    // Always create new hotspot image files in the canonical province + facility folder.
    // Existing references are left intact until explicitly removed, but they no longer
    // dictate the folder for newly added files (which caused location_* vs bihar_* drift).
    if (!h.provinceId && Number.isFinite(Number(h.x)) && Number.isFinite(Number(h.y))) {
        h.provinceId = detectProvinceAtXY(h.x, h.y) || '';
    }
    h._assetFolder = generatedFacilityFolder(h, state.activeSlug);
    const baseDir = `images/${state.activeSlug}/${h._assetFolder}`;
    let added = 0;
    let oversized = 0;

    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        let name = safeFileName(file.name) || `image-${Date.now()}`;
        let path = `${baseDir}/${name}`;
        let n = 2;
        while (allManagedImages(h).includes(path) || state.stagedWrites.has(path)) {
            const dot = name.lastIndexOf('.');
            const base = dot > 0 ? name.slice(0, dot) : name;
            const ext = dot > 0 ? name.slice(dot) : '';
            path = `${baseDir}/${base}-${n}${ext}`;
            n++;
        }
        state.stagedWrites.set(path, file);
        state.stagedDeletes.delete(path);
        state.fileStats.set(path, { exists: true, size: file.size });
        state.imageOptimizationMeta.delete(path);
        h.images.push(path);
        added++;
        if (file.size > PREFERRED_MAX_IMAGE_BYTES) oversized++;
    }
    els.imagePicker.value = '';
    if (!added) return;
    markDirty();
    await renderImagesList();
    refreshHotspotReviewState(h);
    renderHotspotList();
    renderCountryHealth();
    renderCountries();
    toast(oversized
        ? `${added} image${added === 1 ? '' : 's'} added unchanged. ${oversized} exceed the preferred 4 MB maximum and can be reduced manually.`
        : `${added} image${added === 1 ? '' : 's'} added unchanged.`);
}

function imageMimeFromPath(path, blob) {
    if (blob?.type) return blob.type.toLowerCase();
    const ext = String(path).split('.').pop()?.toLowerCase();
    return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' })[ext] || '';
}

async function blobForImagePath(path) {
    let blob = state.stagedWrites.get(path);
    if (typeof blob === 'string') blob = new Blob([blob]);
    return blob || readFilePath(path);
}

async function canvasBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function reduceImageBlob(source, path, mode) {
    const mime = imageMimeFromPath(path, source);
    if (!/^image\/(?:jpeg|png|webp|avif)$/i.test(mime)) {
        throw new Error('This image type is not supported for safe reduction. GIFs are left untouched to avoid losing animation.');
    }

    const bitmap = await createImageBitmap(source);
    try {
        if (mode === 'lossless') {
            if (mime !== 'image/png') throw new Error('Lossless pixel-preserving reduction is currently available for PNG files only.');
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d', { alpha: true });
            ctx.drawImage(bitmap, 0, 0);
            const output = await canvasBlob(canvas, 'image/png');
            if (!output || output.size >= source.size) {
                return { changed: false, message: 'The PNG is already as small as the browser can make it losslessly.' };
            }
            return {
                changed: true,
                blob: output,
                name: path.split('/').pop(),
                originalBytes: source.size,
                finalBytes: output.size,
                width: bitmap.width,
                height: bitmap.height,
                mode: 'lossless',
            };
        }

        const originalW = bitmap.width;
        const originalH = bitmap.height;
        let width = originalW;
        let height = originalH;
        let quality = IMAGE_HIGH_QUALITY_START;
        let best = null;

        async function encodeCurrent() {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { alpha: true });
            ctx.drawImage(bitmap, 0, 0, width, height);
            return canvasBlob(canvas, 'image/webp', quality);
        }

        // First keep full resolution and lower quality only as much as needed.
        while (quality >= IMAGE_HIGH_QUALITY_MIN - 0.001) {
            const blob = await encodeCurrent();
            if (blob && (!best || blob.size < best.size)) best = blob;
            if (blob && blob.size <= PREFERRED_MAX_IMAGE_BYTES) break;
            quality = Math.round((quality - 0.03) * 100) / 100;
        }

        // Only reduce dimensions if quality alone cannot reach the preferred 4 MB target.
        while (best && best.size > PREFERRED_MAX_IMAGE_BYTES && Math.max(width, height) > IMAGE_MIN_LONG_EDGE) {
            const scale = 0.88;
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
            quality = Math.max(0.84, IMAGE_HIGH_QUALITY_MIN);
            const blob = await encodeCurrent();
            if (blob && blob.size < best.size) best = blob;
        }

        if (!best || best.size >= source.size) {
            return { changed: false, message: 'No smaller high-quality version could be produced.' };
        }
        const originalName = path.split('/').pop();
        const base = originalName.replace(/\.[^.]+$/, '') || 'image';
        return {
            changed: true,
            blob: best,
            name: `${base}.webp`,
            originalBytes: source.size,
            finalBytes: best.size,
            width,
            height,
            originalWidth: originalW,
            originalHeight: originalH,
            mode: 'high-quality',
        };
    } finally {
        if (bitmap?.close) bitmap.close();
    }
}

function uniqueOptimizedPath(oldPath, newName) {
    const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '';
    let candidate = `${dir}/${newName}`;
    if (candidate === oldPath) return candidate;
    const allRefs = new Set(Object.values(state.catalog || {}).flatMap(entry => (entry.hotspots || []).flatMap(h => allManagedImages(h))));
    let n = 2;
    const dot = newName.lastIndexOf('.');
    const base = dot > 0 ? newName.slice(0, dot) : newName;
    const ext = dot > 0 ? newName.slice(dot) : '';
    while (allRefs.has(candidate) || state.stagedWrites.has(candidate)) {
        candidate = `${dir}/${base}-${n}${ext}`;
        n++;
    }
    return candidate;
}

function replaceImageReferenceEverywhere(oldPath, newPath) {
    Object.values(state.catalog || {}).forEach(entry => {
        (entry.hotspots || []).forEach(h => {
            h.images = (h.images || []).map(path => path === oldPath ? newPath : path);
            h.inactiveImages = (h.inactiveImages || []).map(path => path === oldPath ? newPath : path);
        });
    });
}

async function applyImageReduction(path, mode, { quiet = false } = {}) {
    const source = await blobForImagePath(path);
    const result = await reduceImageBlob(source, path, mode);
    if (!result.changed) {
        if (!quiet) toast(result.message || 'Image could not be reduced.', true);
        return { changed: false, path, ...result };
    }

    const newPath = mode === 'lossless' ? path : uniqueOptimizedPath(path, result.name);
    if (newPath !== path) {
        replaceImageReferenceEverywhere(path, newPath);
        let existedInRepository = false;
        try { existedInRepository = Boolean((await statPath(path)).exists); } catch (_) { /* treat as staged-only */ }
        if (state.tempStagedPaths.has(path)) {
            await deleteTempPath(path);
            state.tempStagedPaths.delete(path);
        }
        if (state.stagedWrites.has(path)) state.stagedWrites.delete(path);
        if (existedInRepository) state.stagedDeletes.add(path);
        state.fileStats.delete(path);
        state.imageOptimizationMeta.delete(path);
        releaseObjectUrl(path);
    }

    await stageTempPath(newPath, result.blob);
    state.tempStagedPaths.add(newPath);
    state.stagedWrites.set(newPath, result.blob); // kept in memory for instant preview; temp file is authoritative until Apply Changes
    state.stagedDeletes.delete(newPath);
    state.fileStats.set(newPath, { exists: true, size: result.finalBytes, temporary: true });
    state.imageOptimizationMeta.set(newPath, {
        optimized: true,
        mode: result.mode,
        originalBytes: result.originalBytes,
        finalBytes: result.finalBytes,
        width: result.width,
        height: result.height,
    });
    releaseObjectUrl(newPath);
    markDirty();
    if (!quiet) toast(`${path.split('/').pop()}: temporary reduced version staged (${formatBytes(result.originalBytes)} → ${formatBytes(result.finalBytes)}). Repository is unchanged until Apply Changes.`);
    return { changed: true, oldPath: path, newPath, ...result };
}

async function openImageReduceDialog(path) {
    state.imageReducePath = path;
    const stat = await getFileStat(path);
    const blob = await blobForImagePath(path);
    const mime = imageMimeFromPath(path, blob);
    const isPng = mime === 'image/png';
    const losslessInput = els.losslessChoice.querySelector('input');
    losslessInput.disabled = !isPng;
    if (!isPng && losslessInput.checked) document.querySelector('input[name="image-reduce-mode"][value="high-quality"]').checked = true;
    els.imageReduceSummary.innerHTML = `<p><strong>${escapeHtml(path.split('/').pop())}</strong></p><p class="muted">Current size: ${formatBytes(stat?.size || blob.size)} · Preferred maximum: 4 MB.</p>`;
    els.imageReduceMessage.className = 'notice notice-info';
    els.imageReduceMessage.textContent = isPng
        ? 'Lossless attempts keep the exact pixel dimensions and pixel values, while stripping/rebuilding file encoding. High quality mode may convert to WebP and only downsizes if needed.'
        : 'JPEG/WebP/AVIF cannot be meaningfully reduced losslessly in this browser workflow. High quality mode keeps full dimensions when possible and only downsizes if needed to approach 4 MB.';
    els.imageReduceDialog.showModal();
}

async function confirmImageReduction() {
    const path = state.imageReducePath;
    if (!path) return;
    const mode = document.querySelector('input[name="image-reduce-mode"]:checked')?.value || 'high-quality';
    els.confirmImageReduce.disabled = true;
    els.confirmImageReduce.textContent = 'Reducing…';
    try {
        await applyImageReduction(path, mode);
        els.imageReduceDialog.close();
        await renderImagesList();
        refreshHotspotReviewState();
        renderHotspotList();
        renderCountryHealth();
        renderCountries();
    } catch (error) {
        els.imageReduceMessage.className = 'notice notice-error';
        els.imageReduceMessage.textContent = error.message;
    } finally {
        els.confirmImageReduce.disabled = false;
        els.confirmImageReduce.textContent = 'Reduce Image';
    }
}

async function renderImagesList() {
    const h = activeHotspot();
    els.imageList.innerHTML = '';
    const managed = allManagedImages(h);
    if (!h || !managed.length) {
        els.imageList.innerHTML = '<div class="empty-state compact">No photos added yet.</div>';
        return;
    }

    const rows = [
        ...(h.images || []).map((path, index) => ({ path, used: true, index })),
        ...(h.inactiveImages || []).map(path => ({ path, used: false, index: -1 })),
    ];

    rows.forEach(({ path, used, index }) => {
        const row = document.createElement('div');
        row.className = `image-row${used ? '' : ' is-unused'}`;
        const img = document.createElement('img');
        img.className = 'image-thumb';
        img.alt = '';
        const text = document.createElement('div');
        text.className = 'image-copy';
        const strong = document.createElement('strong');
        strong.textContent = path.split('/').pop();
        const small = document.createElement('small');
        small.className = 'image-details';
        renderImageDetails(small, path);
        text.append(strong, small);

        const actions = document.createElement('div');
        actions.className = 'image-actions';

        const useToggle = document.createElement('label');
        useToggle.className = 'image-use-toggle';
        useToggle.title = used ? 'This image is shown on the public map' : 'Keep the file, but do not show it on the public map';
        const useInput = document.createElement('input');
        useInput.type = 'checkbox';
        useInput.checked = used;
        useInput.setAttribute('aria-label', `Use ${path.split('/').pop()} on public map`);
        const useSwitch = document.createElement('span');
        useSwitch.className = 'image-use-switch';
        const useLabel = document.createElement('span');
        useLabel.className = 'image-use-label';
        useLabel.textContent = used ? 'Used' : 'Unused';
        useInput.addEventListener('change', () => { useInput.blur(); toggleImageUsage(path, useInput.checked); });
        useToggle.append(useInput, useSwitch, useLabel);

        const reduceButton = imageActionButton('Reduce', 'Reduce file size', () => openImageReduceDialog(path), false);
        reduceButton.classList.add('image-reduce-button');
        actions.append(
            useToggle,
            reduceButton,
            imageActionButton('up', 'Move up', () => moveImage(index, -1), !used || index === 0),
            imageActionButton('down', 'Move down', () => moveImage(index, 1), !used || index === (h.images || []).length - 1),
            imageActionButton('remove', 'Remove file', () => removeImagePath(path), false),
        );
        row.append(img, text, actions);
        els.imageList.appendChild(row);
        getObjectUrlForPath(path).then(url => { if (url) img.src = url; }).catch(() => {});
        const opt = state.imageOptimizationMeta.get(path);
        if (opt) {
            renderImageDetails(small, path, {
                meta: formatBytes(opt.finalBytes),
                badge: opt.optimized ? `${opt.mode === 'lossless' ? 'lossless' : 'reduced'} from ${formatBytes(opt.originalBytes)}` : '',
            });
        } else {
            getFileStat(path).then(stat => {
                if (!stat?.exists || !Number.isFinite(stat.size)) return;
                renderImageDetails(small, path, { meta: formatBytes(stat.size) });
                small.classList.toggle('image-size-warning', stat.size > OVERSIZED_IMAGE_BYTES);
                small.classList.toggle('image-size-ok', stat.size <= OVERSIZED_IMAGE_BYTES);
            }).catch(() => {});
        }
    });
}

function appendBreakablePath(target, path) {
    const parts = String(path || '').split(/([\/_-])/);
    parts.forEach(part => {
        if (!part) return;
        target.appendChild(document.createTextNode(part));
        if (part === '/' || part === '_' || part === '-') target.appendChild(document.createElement('wbr'));
    });
}

function renderImageDetails(container, path, { meta = '', badge = '' } = {}) {
    container.replaceChildren();
    container.classList.remove('image-size-warning', 'image-size-ok');
    const pathLine = document.createElement('span');
    pathLine.className = 'image-path-line';
    appendBreakablePath(pathLine, path);
    container.appendChild(pathLine);
    if (meta || badge) {
        const metaLine = document.createElement('span');
        metaLine.className = 'image-meta-line';
        if (meta) {
            const size = document.createElement('span');
            size.className = 'image-size-label';
            size.textContent = meta;
            metaLine.appendChild(size);
        }
        if (badge) {
            const badgeNode = document.createElement('span');
            badgeNode.className = 'optimized-badge';
            badgeNode.textContent = badge;
            metaLine.appendChild(badgeNode);
        }
        container.appendChild(metaLine);
    }
}

function imageActionButton(icon, title, onClick, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'image-icon-button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.disabled = disabled;
    button.innerHTML = uiIconMarkup(icon);
    button.addEventListener('click', onClick);
    return button;
}

function uiIconMarkup(name) {
    const paths = {
        up: '<path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/>',
        down: '<path d="M8 3.5v9M4.5 9 8 12.5 11.5 9"/>',
        remove: '<path d="M4 4l8 8M12 4 4 12"/>',
    };
    return `<svg class="ui-icon" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</g></svg>`;
}

function toggleImageUsage(path, useOnMap) {
    const h = activeHotspot();
    if (!h) return;
    const viewport = captureWorkspaceViewport();
    setImageUse(h, path, useOnMap);
    markDirty();
    void renderImagesList();
    refreshHotspotReviewState(h);
    renderHotspotList();
    renderCountryHealth();
    renderCountries();
    restoreWorkspaceViewport(viewport);
    toast(useOnMap ? 'Image enabled for the public map.' : 'Image kept in the project but hidden from the public map.');
}

function captureWorkspaceViewport() {
    if (!els.workspace) return null;
    return { top: els.workspace.scrollTop, left: els.workspace.scrollLeft };
}

function restoreWorkspaceViewport(viewport) {
    if (!viewport || !els.workspace) return;
    requestAnimationFrame(() => {
        const maxTop = Math.max(0, els.workspace.scrollHeight - els.workspace.clientHeight);
        const maxLeft = Math.max(0, els.workspace.scrollWidth - els.workspace.clientWidth);
        els.workspace.scrollTop = Math.min(viewport.top, maxTop);
        els.workspace.scrollLeft = Math.min(viewport.left, maxLeft);
    });
}

function moveImage(index, delta) {
    const h = activeHotspot();
    if (!h) return;
    const next = index + delta;
    if (next < 0 || next >= h.images.length) return;
    [h.images[index], h.images[next]] = [h.images[next], h.images[index]];
    markDirty();
    renderImagesList();
}

function removeImagePath(path) {
    const h = activeHotspot();
    if (!h) return;
    h.images = (h.images || []).filter(item => item !== path);
    h.inactiveImages = (h.inactiveImages || []).filter(item => item !== path);
    if (state.tempStagedPaths.has(path)) { void deleteTempPath(path); state.tempStagedPaths.delete(path); }
    if (state.stagedWrites.has(path)) state.stagedWrites.delete(path);
    else state.stagedDeletes.add(path);
    state.imageOptimizationMeta.delete(path);
    state.fileStats.delete(path);
    releaseObjectUrl(path);
    markDirty();
    renderImagesList();
    refreshHotspotReviewState(h);
    renderHotspotList();
    renderCountryHealth();
    renderCountries();
}

async function getObjectUrlForPath(path) {
    if (state.objectUrls.has(path)) return state.objectUrls.get(path);
    let blob = state.stagedWrites.get(path);
    if (typeof blob === 'string') blob = new Blob([blob]);
    if (!blob) {
        try { blob = await readFilePath(path); } catch (_) { return ''; }
    }
    const url = URL.createObjectURL(blob);
    state.objectUrls.set(path, url);
    return url;
}

function releaseObjectUrl(path) {
    const url = state.objectUrls.get(path);
    if (url) URL.revokeObjectURL(url);
    state.objectUrls.delete(path);
}

function openDeleteDialog() {
    const h = activeHotspot();
    if (!h) return;
    els.deleteMessage.textContent = `Delete “${h.title || 'this hotspot'}”?`;
    document.querySelector('input[name="delete-mode"][value="hotspot"]').checked = true;
    els.deleteDialog.showModal();
}

function confirmDeleteHotspot() {
    const entry = activeEntry();
    const h = activeHotspot();
    if (!entry || !h) return;
    const mode = document.querySelector('input[name="delete-mode"]:checked')?.value || 'hotspot';
    if (mode === 'all') {
        allManagedImages(h).forEach(path => {
            if (state.tempStagedPaths.has(path)) { void deleteTempPath(path); state.tempStagedPaths.delete(path); }
            if (state.stagedWrites.has(path)) state.stagedWrites.delete(path);
            else state.stagedDeletes.add(path);
            state.imageOptimizationMeta.delete(path);
            state.fileStats.delete(path);
            releaseObjectUrl(path);
        });
    }
    entry.hotspots.splice(state.activeHotspotIndex, 1);
    state.activeHotspotIndex = null;
    state.mapHotspotIndex = null;
    state.selectedHotspots.clear();
    markDirty();
    els.deleteDialog.close();
    renderHotspotList();
    renderEditor();
    renderCountryHealth();
    renderCountries();
    updatePreviewMarkers();
}

async function prepareSaveDialog() {
    if (!state.repositoryReady || !state.catalog) return;
    try {
        els.saveValidationNote.innerHTML = '<p>Validating before save…</p>';
        els.changeSummary.textContent = buildChangeSummary();
        els.confirmSave.disabled = true;
        els.saveDialog.showModal();
        const issues = await validateEverything();
        const errors = issues.filter(i => i.level === 'error');
        const warnings = issues.filter(i => i.level === 'warning');
        if (errors.length) {
            els.saveValidationNote.innerHTML = `<div class="notice notice-error">${errors.length} blocking error${errors.length === 1 ? '' : 's'} found. Fix them before applying changes.</div>`;
            els.confirmSave.disabled = true;
        } else {
            els.saveValidationNote.innerHTML = `<div class="notice ${warnings.length ? 'notice-warning' : 'notice-ok'}">No blocking errors. ${warnings.length} warning${warnings.length === 1 ? '' : 's'} remain and can be accepted.</div>`;
            els.confirmSave.disabled = false;
        }
    } catch (error) {
        console.error(error);
        els.saveValidationNote.innerHTML = `<div class="notice notice-error">${escapeHtml(error.message)}</div>`;
    }
}

function buildChangeSummary() {
    const lines = [];
    lines.push('data/catalog.js');
    lines.push('  ~ rewrite catalog from the manager state');
    if (state.stagedWrites.size) {
        lines.push('');
        lines.push('Files to add/replace:');
        [...state.stagedWrites.keys()].sort().forEach(path => lines.push(`  + ${path}${state.tempStagedPaths.has(path) ? '  [temporary staged reduction]' : ''}`));
    }
    if (state.stagedDeletes.size) {
        lines.push('');
        lines.push('Files to remove:');
        [...state.stagedDeletes].sort().forEach(path => lines.push(`  - ${path}`));
    }
    if (!state.stagedWrites.size && !state.stagedDeletes.size) {
        lines.push('');
        lines.push('No image/SVG file changes are staged.');
    }
    lines.push('');
    lines.push('Git commit/push is intentionally not handled by this app.');
    return lines.join('\n');
}

async function saveToRepository() {
    if (!state.repositoryReady) return;
    els.confirmSave.disabled = true;
    try {
        // Write additions/replacements first; catalog second; deletions last. This reduces the
        // chance of a partially failed save leaving the public site referencing missing files.
        for (const [path, data] of state.stagedWrites) {
            if (state.tempStagedPaths.has(path)) await applyTempPath(path);
            else await writePath(path, data);
        }
        const catalogText = serializeCatalog(state.catalog);
        await writePath('data/catalog.js', catalogText);
        for (const path of state.stagedDeletes) await removePath(path);

        state.originalCatalogText = catalogText;
        refreshAllHotspotBaselines();
        state.stagedWrites.clear();
        state.stagedDeletes.clear();
        state.tempStagedPaths.clear();
        await clearTempWorkspace();
        state.dirty = false;
        state.importHistory.forEach(item => { item.saved = true; });
        clearDirtyIndicator();
        const switchTo = state.pendingCountrySwitch;
        state.pendingCountrySwitch = null;
        els.saveDialog.close();
        renderCountries();
        renderCountryHealth();
        toast('Changes applied. Review the Git diff, then commit and push normally.');
        if (switchTo) await performCountrySelection(switchTo);
    } catch (error) {
        console.error(error);
        els.confirmSave.disabled = false;
        els.saveValidationNote.innerHTML = `<div class="notice notice-error">Save failed: ${escapeHtml(error.message)}</div>`;
    }
}

function serializeCatalog(catalog) {
    const cleaned = JSON.parse(JSON.stringify(catalog, (key, value) => key.startsWith('_') ? undefined : value));
    return `// MAP_CATALOG - generated by the local Map Content Manager.\n` +
        `// Public map behavior remains in data/main.js. Edit map content through /manager/.\n\n` +
        `const MAP_CATALOG = ${JSON.stringify(cleaned, null, 4)};\n`;
}

function markDirty() {
    if (state.activeSlug) state.deepValidationIssues.delete(state.activeSlug);
    state.dirty = true;
    els.resetChanges.disabled = false;
    els.saveAll.disabled = false;
    els.saveAll.classList.add('is-dirty');
    els.reviewIndicator?.classList.add('warning');
    els.saveAll.title = 'Unsaved changes - review before applying';
}

function clearDirtyIndicator() {
    els.resetChanges.disabled = true;
    els.saveAll.disabled = true;
    els.saveAll.classList.remove('is-dirty');
    els.reviewIndicator?.classList.remove('warning');
    els.saveAll.title = 'No unsaved changes';
}

async function resetUnsavedChanges() {
    if (!state.dirty) return;
    if (!window.confirm('Discard all unsaved changes and reload the manager state from the repository?')) return;
    await discardUnsavedChanges(state.activeSlug);
}

async function discardAndSwitchCountry() {
    const target = state.pendingCountrySwitch;
    els.unsavedDialog.close();
    state.pendingCountrySwitch = null;
    await discardUnsavedChanges(target);
}

async function discardUnsavedChanges(selectSlug = null) {
    try {
        hideHotspotHoverCard();
        for (const url of state.objectUrls.values()) URL.revokeObjectURL(url);
        state.objectUrls.clear();
        state.stagedWrites.clear();
        state.stagedDeletes.clear();
        state.tempStagedPaths.clear();
        await clearTempWorkspace();
        state.selectedHotspots.clear();
        state.imageOptimizationMeta.clear();
        state.fileStats.clear();
        state.importHistory = state.importHistory.filter(item => item.saved);
        state.svgSources.clear();
        state.svgMeta.clear();
        state.originalCatalogText = await readTextPath('data/catalog.js');
        state.catalog = parseCatalogSource(state.originalCatalogText);
        normalizeCatalogRecords();
        state.dirty = false;
        state.activeHotspotIndex = null;
        state.mapHotspotIndex = null;
        state.previewBaseView = null;
        state.previewView = null;
        clearDirtyIndicator();
        renderCountries();
        if (selectSlug && state.catalog[selectSlug]) await performCountrySelection(selectSlug);
        else {
            state.activeSlug = null;
            renderWorkspace();
        }
        toast('Unsaved changes discarded.');
    } catch (error) {
        console.error(error);
        toast(`Could not reset changes: ${error.message}`, true);
    }
}

async function readTextPath(path) {
    if (state.stagedWrites.has(path)) {
        const staged = state.stagedWrites.get(path);
        return typeof staged === 'string' ? staged : staged.text();
    }
    const file = await readFilePath(path);
    return file.text();
}

async function readFilePath(path) {
    const response = await fetch(`/__manager__/file?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not read ${path} (${response.status}).`);
    return response.blob();
}


async function statPath(path, includeHash = false) {
    const hashPart = includeHash ? '&hash=1' : '';
    const response = await fetch(`/__manager__/stat?path=${encodeURIComponent(path)}${hashPart}`, { cache: 'no-store' });
    if (response.status === 404) return { exists: false, size: NaN };
    if (!response.ok) throw new Error(`Could not inspect ${path} (${response.status}).`);
    return response.json();
}

async function getFileStat(path, includeHash = false) {
    const cached = state.fileStats.get(path);
    if (cached && (!includeHash || cached.sha256)) return cached;
    if (state.stagedWrites.has(path)) {
        const data = state.stagedWrites.get(path);
        const size = typeof data === 'string' ? new Blob([data]).size : data?.size;
        const stat = { exists: true, size: Number(size) };
        state.fileStats.set(path, stat);
        return stat;
    }
    const stat = await statPath(path, includeHash);
    state.fileStats.set(path, { ...(cached || {}), ...stat });
    return state.fileStats.get(path);
}

async function listPath(path) {
    const response = await fetch(`/__manager__/list?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
    if (!response.ok) {
        let message = `Could not list ${path}.`;
        try { message = (await response.json()).error || message; } catch (_) { /* ignore */ }
        throw new Error(message);
    }
    const payload = await response.json();
    return Array.isArray(payload.files) ? payload.files : [];
}

async function stageTempPath(path, data) {
    const response = await fetch(`/__manager__/temp/write?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'Content-Type': data?.type || 'application/octet-stream', 'X-Manager-Token': state.apiToken },
        body: data,
    });
    if (!response.ok) {
        let message = `Could not stage temporary file for ${path}.`;
        try { message = (await response.json()).error || message; } catch (_) { /* ignore */ }
        throw new Error(message);
    }
}

async function applyTempPath(path) {
    const response = await fetch(`/__manager__/temp/apply?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'X-Manager-Token': state.apiToken },
    });
    if (!response.ok) {
        let message = `Could not apply staged temporary file for ${path}.`;
        try { message = (await response.json()).error || message; } catch (_) { /* ignore */ }
        throw new Error(message);
    }
}

async function deleteTempPath(path) {
    const response = await fetch(`/__manager__/temp/delete?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'X-Manager-Token': state.apiToken },
    });
    if (!response.ok && response.status !== 404) console.warn(`Could not delete temporary staged file for ${path}.`);
}

async function clearTempWorkspace() {
    if (!state.apiToken) return;
    const response = await fetch('/__manager__/temp/clear', {
        method: 'POST',
        headers: { 'X-Manager-Token': state.apiToken },
    });
    if (!response.ok) console.warn('Could not clear the manager temporary workspace.');
}

async function writePath(path, data) {
    const response = await fetch(`/__manager__/write?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'Content-Type': data?.type || (typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/octet-stream'), 'X-Manager-Token': state.apiToken },
        body: data,
    });
    if (!response.ok) {
        let message = `Could not write ${path}.`;
        try { message = (await response.json()).error || message; } catch (_) { /* ignore */ }
        throw new Error(message);
    }
}

async function removePath(path) {
    const response = await fetch(`/__manager__/delete?path=${encodeURIComponent(path)}`, { method: 'POST', headers: { 'X-Manager-Token': state.apiToken } });
    if (!response.ok) {
        let message = `Could not delete ${path}.`;
        try { message = (await response.json()).error || message; } catch (_) { /* ignore */ }
        throw new Error(message);
    }
}

function inferAssetFolder(hotspot, slug) {
    const image = allManagedImages(hotspot)[0];
    if (image) {
        const prefix = `images/${slug}/`;
        if (image.startsWith(prefix)) {
            const rest = image.slice(prefix.length);
            if (rest.includes('/')) return rest.split('/')[0];
        }
    }
    return generatedFacilityFolder(hotspot, slug);
}

function provinceFolderPart(hotspot, slug = state.activeSlug) {
    const provinceId = String(hotspot?.provinceId || '').trim();
    const meta = state.svgMeta.get(slug);
    const region = meta?.regions?.find(item => item.id === provinceId);
    const canonical = String(region?.name || '').trim();
    if (canonical && canonical !== provinceId) return slugifyPart(canonical);
    if (provinceId) {
        const suffix = provinceId.split('-').filter(Boolean).pop() || provinceId;
        return slugifyPart(suffix);
    }
    return 'region';
}

function generatedFacilityFolder(hotspot, slug = state.activeSlug) {
    const province = provinceFolderPart(hotspot, slug);
    const facility = slugifyPart(hotspot?.title || 'hotspot');
    const joined = `${province}_${facility}`.replace(/_+/g, '_').replace(/^_|_$/g, '');
    return joined.slice(0, 90) || 'hotspot';
}

function safeFileName(name) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
    return `${slugifyPart(base).replace(/_/g, '-') || 'image'}${ext}`;
}

function slugifyPart(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeCountrySlug(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[0-9]/g, '')
        .replace(/[^a-z]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}

function normalizeSlug(value) {
    return normalizeCountrySlug(value);
}

function normalizeHeader(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizedText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeYear(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const n = Number(text);
    return Number.isFinite(n) && /^\d+(?:\.0+)?$/.test(text) ? Math.trunc(n) : text;
}

function countryNameFromEntry(entry) {
    if (!entry) return '';
    if (String(entry.countryName || '').trim()) return String(entry.countryName).trim();
    return String(entry.title || '').replace(/^Hospital Projects in\s+/i, '').replace(/^Projects in\s+/i, '').trim();
}

function looselySameCountry(excelCountry, mapCountry, slug) {
    const clean = value => normalizedText(value).replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
    const a = clean(excelCountry);
    const b = clean(mapCountry);
    const c = clean(slug);
    return a === b || a === c || a.includes(b) || b.includes(a);
}


function textSimilarity(a, b) {
    const x = normalizedText(a).replace(/[^a-z0-9]+/g, ' ').trim();
    const y = normalizedText(b).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!x || !y) return 0;
    if (x === y) return 1;
    const bigrams = value => {
        const compact = value.replace(/\s+/g, ' ');
        if (compact.length < 2) return [compact];
        const out = [];
        for (let i = 0; i < compact.length - 1; i++) out.push(compact.slice(i, i + 2));
        return out;
    };
    const ax = bigrams(x);
    const by = bigrams(y);
    const counts = new Map();
    ax.forEach(item => counts.set(item, (counts.get(item) || 0) + 1));
    let overlap = 0;
    by.forEach(item => {
        const count = counts.get(item) || 0;
        if (count > 0) {
            overlap++;
            counts.set(item, count - 1);
        }
    });
    return (2 * overlap) / (ax.length + by.length);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
    const values = [lat1, lon1, lat2, lon2].map(Number);
    if (!values.every(Number.isFinite)) return Infinity;
    const [a1, o1, a2, o2] = values.map(value => value * Math.PI / 180);
    const dLat = a2 - a1;
    const dLon = o2 - o1;
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const h = sinLat * sinLat + Math.cos(a1) * Math.cos(a2) * sinLon * sinLon;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function dedupeIssues(issues) {
    const seen = new Set();
    return issues.filter(issue => {
        const key = `${issue.slug || ''}|${issue.level}|${issue.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '-';
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
    return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function columnLetter(number) {
    let result = '';
    let n = number;
    while (n > 0) {
        n--;
        result = String.fromCharCode(65 + (n % 26)) + result;
        n = Math.floor(n / 26);
    }
    return result;
}

function formatNumber(value, decimals) {
    const n = Number(value);
    return Number.isFinite(n) ? String(round(n, decimals)) : '';
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function round(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

let toastTimer = null;
function toast(message, isError = false) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.style.background = isError ? '#b42318' : '#101828';
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3600);
}

window.addEventListener('beforeunload', event => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
});
