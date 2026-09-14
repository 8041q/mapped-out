/*
 * Human-facing region abbreviations used by the manager's Country Codes overlay.
 *
 * This data is intentionally separate from manager.js so a country with numeric or
 * otherwise non-human-facing SVG IDs can be supported without changing application
 * logic. SVG authors can avoid this table entirely by adding data-code, data-abbr,
 * or data-label attributes directly to each region path.
 */
'use strict';

window.MAPPED_OUT_REGION_CODES = Object.freeze({
    thailand: Object.freeze({
        'TH-10': 'BKK', 'TH-11': 'SPK', 'TH-12': 'NBI', 'TH-13': 'PTE', 'TH-14': 'AYA',
        'TH-15': 'ATG', 'TH-16': 'LRI', 'TH-17': 'SBR', 'TH-18': 'CNT', 'TH-19': 'SRB',
        'TH-20': 'CBI', 'TH-21': 'RYG', 'TH-22': 'CTI', 'TH-23': 'TRT', 'TH-24': 'CCO',
        'TH-25': 'PRI', 'TH-26': 'NYK', 'TH-27': 'SKW', 'TH-30': 'NMA', 'TH-31': 'BRM',
        'TH-32': 'SRN', 'TH-33': 'SSK', 'TH-34': 'UBN', 'TH-35': 'YST', 'TH-36': 'CPM',
        'TH-37': 'ACR', 'TH-38': 'BKN', 'TH-39': 'NBP', 'TH-40': 'KKN', 'TH-41': 'UDN',
        'TH-42': 'LEI', 'TH-43': 'NKI', 'TH-44': 'MKM', 'TH-45': 'RET', 'TH-46': 'KSN',
        'TH-47': 'SNK', 'TH-48': 'NPM', 'TH-49': 'MDH', 'TH-50': 'CMI', 'TH-51': 'LPN',
        'TH-52': 'LPG', 'TH-53': 'UTD', 'TH-54': 'PRE', 'TH-55': 'NAN', 'TH-56': 'PYO',
        'TH-57': 'CRI', 'TH-58': 'MSN', 'TH-60': 'NSN', 'TH-61': 'UTI', 'TH-62': 'KPT',
        'TH-63': 'TAK', 'TH-64': 'STI', 'TH-65': 'PLK', 'TH-66': 'PCT', 'TH-67': 'PNB',
        'TH-70': 'RBR', 'TH-71': 'KRI', 'TH-72': 'SPB', 'TH-73': 'NPT', 'TH-74': 'SKN',
        'TH-75': 'SKM', 'TH-76': 'PBI', 'TH-77': 'PKN', 'TH-80': 'NRT', 'TH-81': 'KBI',
        'TH-82': 'PNA', 'TH-83': 'PKT', 'TH-84': 'SRT', 'TH-85': 'RNG', 'TH-86': 'CPN',
        'TH-90': 'SKA', 'TH-91': 'STN', 'TH-92': 'TRG', 'TH-93': 'PLG', 'TH-94': 'PTN',
        'TH-95': 'YLA', 'TH-96': 'NWT', 'TH-S': 'PTY',
    }),
});
