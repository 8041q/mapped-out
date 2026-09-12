# Map Content Manager

This is a local editing UI for the existing interactive map project. It does **not** replace or redesign the public page. It writes the same repository files that the public page already reads.

## Install / location

Keep these files at the repository root:

```text
/start_manager.py
/start_manager.bat
/start_manager.command
/manager/
/data/catalog.js
/images/
```

The launcher uses the folder containing `start_manager.py` as the repository root. No folder picker is needed, and launching it from a shortcut does not change which repository is edited.

## Run it

From the repository root, either:

- `python start_manager.py`
- Windows: double-click `start_manager.bat`
- macOS: run `start_manager.command`

The manager opens automatically at `http://127.0.0.1:<port>/manager/` and verifies that `data/catalog.js` and `images/` exist beside the launcher.

## Required data

### New country

Required:

- Country name
- Country slug
- Country SVG

The public map title is optional; if omitted it becomes `Hospital Projects in <Country>`.

### Hotspot

Required before saving:

- Hospital / facility name
- Latitude
- Longitude
- Province / state (`provinceId`), normally detected automatically from the SVG

Optional:

- City / region
- Year
- Address
- Case description
- Images (a warning is shown if none are present, but this does not block saving)

## Excel template contract

The first worksheet must contain these columns **before the Image column**:

1. Country
2. City
3. Hospital Name
4. Year
5. Address
6. Case Description
7. Latitude
8. Longitude
9. Image

The columns remain part of the fixed template, but City, Year, Address and Case Description may be blank.

The **Image** column may move. The manager finds it by header name and ignores that column and every column after it. Images are added separately through drag-and-drop.

Rows are read until the manager sees **five consecutive empty rows** across the meaningful columns before `Image`. One or several isolated blank rows do not end the import.

Coordinates can be plain numbers or directional text such as `15.0345° N` and `120.6845° E`.

## SVG handling

The manager reads `mapsvg:geoViewBox` and either an SVG `viewBox` or numeric `width`/`height`. If a supplied SVG has only width/height (such as the Thailand MapSVG export), the manager creates the equivalent preview viewBox automatically so the full map is visible.

The full-width Map Editor uses larger visible hotspot markers plus larger transparent drag handles. Dragging updates x/y, latitude/longitude and province detection.

## Map colours

Map Settings keeps the existing HSL configuration (`baseHue`, saturation, min light and max light), and adds:

- a native colour picker
- a live gradient preview of the configured map shade range

The picker updates hue and saturation while preserving the chosen min/max lightness range.

## Saving and Git

**Save Changes** writes directly into the repository through the local Python server. The app intentionally does not commit, push or deploy anything. Review the Git diff, then commit/push normally; the existing GitHub Action can continue deploying the public site.

## Compatibility

Existing hotspots that only have x/y are backfilled to lat/lon when their map is opened. Extra manager-only/content fields are safe because the public map runtime ignores fields it does not use.

## Map navigation and editing

The Map Editor behaves like a map rather than a static preview:

- Mouse wheel over the map: zoom in/out around the cursor
- Drag the map background: pan
- `+` / `−` buttons: zoom from the centre
- `Fit`: return to the full-country view
- Drag a hotspot: move that hotspot rather than the map
- Hover a hotspot: show facility name, city/region when available, and latitude/longitude

The map surface disables browser touch scrolling/overscroll while interacting with it, so dragging a hotspot or panning the map does not scroll the page.

## Unsaved changes

Unsaved changes are tracked across country settings, hotspots, SVG replacements, images and deletions.

When switching to another country with pending changes, the manager asks whether to:

- stay and keep editing
- discard the changes and switch
- review/save the changes first

`Reset Unsaved` in the header reloads the manager state from the files currently on disk. The browser also warns before closing/reloading the manager while changes are pending.

## Smart Excel re-import / merge

Re-importing an updated workbook no longer blindly duplicates existing hotspots.

The manager classifies each Excel row as:

- **unchanged** — existing data already matches, so nothing is rewritten
- **update** — a unique existing facility match was found; changed fields are merged while existing images are preserved
- **new** — no reasonable match exists, so a new hotspot will be created
- **conflict** — more than one possible/fuzzy match exists; the user must choose the correct hotspot or explicitly add it as new

Blank optional Excel values do not erase richer information already stored in the manager.

The latest imports for each country are shown in an **Import history · this session** strip with counts for new, updated and unchanged rows.

## Hotspot status colours

The editor now uses all three marker colours consistently:

- **Green — Valid:** all required values are valid and no review warnings are present
- **Yellow — Needs review:** usable/non-blocking issues such as missing images, coordinate ambiguity, possible duplicates, images above the preferred 4 MB maximum, resolved import conflicts or province/geometry mismatch. Missing optional city/description is informational only and does not make a hotspot yellow.
- **Red — Invalid:** blocking problems such as missing facility name, latitude/longitude, generated x/y, province/state, invalid SVG province IDs or coordinates outside the map

Optional fields remain optional: yellow warnings never prevent saving by themselves.

## Image size and manual reduction

Images are **never changed automatically on upload**. They are added to the repository exactly as supplied. The preferred maximum file size is **4 MB per image**; larger images generate a non-blocking yellow warning.

Every image has a **Reduce** action, including images that were already present in the repository. PNG files can first try a pixel-preserving/lossless re-encode. JPEG, WebP and AVIF require high-quality recompression to meaningfully reduce size. High-quality mode targets 4 MB, keeps the original pixel dimensions whenever quality reduction is enough, and only downsizes when needed.

The **Reduce > 4 MB** country action is an explicit bulk operation. It never runs by itself and asks for confirmation before changing anything. All results are staged like normal manager edits and are only written when **Save Changes** is confirmed.

## Bulk hotspot tools

The hotspot list supports multi-select checkboxes and filters for:

- invalid
- needs review
- valid
- missing images
- imported during the current manager session

Selected hotspots can be validated together, assigned to one province/state, stripped of images, or deleted together. **Clean Unused Images** scans the selected country's image directory and stages unreferenced image files for deletion; nothing is deleted from disk until **Save Changes** is confirmed.

## Strong validation

Full validation now additionally checks for:

- missing referenced image files
- oversized images
- identical/near-duplicate facility names
- hotspots extremely close to each other
- duplicate image references and identical image content even under different filenames
- province IDs no longer present after SVG replacement
- markers whose SVG geometry falls inside a different province than their stored `provinceId`
- unused image files
- countries with no hotspots

The normal required-field rules remain unchanged.

## Country statistics

Country cards now show hotspot count, image count and a green/yellow/red health indicator. The selected country's health strip separately shows invalid, review and valid hotspot counts, image count and SVG region count.


## Temporary image reduction staging

Image reduction is non-destructive until the final **Apply Changes** step. When you reduce an image, the manager writes the prepared result into an operating-system temporary workspace outside the repository and uses that version for preview/validation. The original repository image is not overwritten at that point. **Reset Unsaved**, **Discard & Switch**, or closing the local server discards the staged temporary files. Only **Apply Changes** copies the staged result into the repository.
