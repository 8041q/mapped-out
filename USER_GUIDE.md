# Project Map Manager - User Guide

This tool lets you update the interactive project maps without editing JavaScript. It works directly with the project repository. Nothing is committed or pushed to GitHub automatically, you need to manually commit the changes to upload data.

## The normal workflow

1. Start the manager with `launcher.bat` or `launcher.command` (Windows/macOS launcher).
2. Choose the country you want to work on from the left side.
3. Import the standard Excel file, add a hotspot manually, or edit an existing hotspot.
4. Add photos separately by dragging them onto the hotspot.
5. Check the marker on the Map editor and fix its position if necessary.
6. Choose **Validate country**. Fix blocking problems and review anything shown in yellow. Use **Issues** for the project-wide view.
7. Choose **Review changes**, read the summary, then choose **Apply changes**.
8. Review the Git changes, commit, and push as you normally do. The existing GitHub Action handles the website update.

The repository is only changed at step 7. Edits, image reductions, SVG replacements, and deletions remain pending until **Apply changes** is selected.

## What the colours mean

**Green - Valid**  
The hotspot has the required information and no review warning was found.

**Yellow - Needs review**  
The hotspot can still be saved, but something is worth checking. Common examples are a missing photo, an image above 4 MB, a possible duplicate, an uncertain coordinate pair, or a province mismatch.

**Red - Invalid**  
Something required is missing or invalid. Red problems must be fixed before changes can be applied.

The required hotspot fields are facility name, latitude, longitude, and province/state. City/region, year, address, case description, and photos are optional.

## Importing the Excel template

Choose **Import Excel** while the correct country is selected. The manager reads the first worksheet and expects the normal template columns: Country, City, Hospital Name, Year, Address, Case Description, Latitude, Longitude, and Image.

The **Image** column is only a cutoff marker. The manager ignores that column and everything to its right. Photos are always added separately in the manager.

Blank rows are allowed. The import stops only after **five consecutive empty rows**, so an accidental empty row in the middle of the sheet will not end the import.

When importing an updated spreadsheet, the manager compares it with the existing hotspots. It shows rows as **New**, **Update**, **Unchanged**, or **Conflict**. Existing photos are kept when a hotspot is updated. A conflict must be reviewed before the import can continue.

## Coordinates and province/state

Latitude and longitude may be normal decimal values or directional values such as `15.0345° N` and `120.6845° E`.

The manager checks whether coordinates fit the selected country. If they appear to be swapped, it will warn you and may offer a suggested swap. It also converts latitude/longitude to the SVG position automatically and detects the province/state from the country SVG.

You can always override the province/state manually if the automatic result is wrong.

## Using the Map editor

Use the `+` and `−` buttons in the corner to zoom and **Fit** to return to the full country. Drag the map background to pan. Normal scrolling still scrolls the manager; hold **Ctrl** while scrolling over the map to zoom at the pointer. The editor-only watermark control has three modes: **Off**, **Country Codes** (a human-facing province/state abbreviation such as `AYA` or `NEC`), and **Numbers** (the exact raw SVG region ID such as `TH-14`, `PH-NEC`, or `PH_MG`).

Hover a hotspot to see its facility name, city/region when available, and current coordinates. Drag a hotspot to correct its position. Latitude, longitude, and SVG position update together, but the assigned province/state does not silently change. If the marker no longer falls inside its assigned province/state, the marker turns yellow and the Province/state field shows a **Mismatch** review badge.

If you move a hotspot and want to undo only its map position, use **Reset selected**. This restores the hotspot's latitude, longitude, map position and province/state to its baseline from the last applied state. For a new/imported hotspot that has not been applied yet, it returns to the position where it was first added/imported. Text and image edits are left alone.

## Adding and managing photos

Select a hotspot and drag photos into the Images area, or choose **Add images**. New hotspot folders are generated consistently from the detected province/state name followed by the facility name. Existing folders that already contain referenced images are preserved so paths are not broken.

A preferred maximum of **4 MB per image** is used as a warning threshold. Images are never reduced automatically. Choose **Reduce** on an individual image only when you want to optimize that file.

Each photo also has a **Used / Unused** switch. **Used** photos appear in the public hotspot carousel. **Unused** photos stay in the project and can be turned back on later, but they are not shown on the public map and are not treated as orphaned files.

A reduced image is prepared in a temporary workspace first. The original repository file remains untouched until **Apply changes**. Discarding/resetting the edits removes the temporary version.

PNG files can try a lossless, pixel-preserving reduction. JPEG, WebP, and AVIF use a high-quality reduction because meaningful size savings are not truly lossless for those formats.

## Adding a new country

Choose the `+` button beside Countries. Country name, country slug, and the country SVG are required. Slugs are normalized live to lowercase letters and hyphens; uppercase characters are converted immediately and numbers are removed. The public title and description can be edited but are optional.

The manager reads the SVG geographic bounds, map size, and province/state IDs automatically. If the SVG provides width/height instead of a `viewBox`, the manager creates the equivalent preview view internally without changing the original SVG. Region IDs inside the SVG must be unique; duplicate IDs are reported as a blocking map issue because hotspots cannot be matched reliably when two shapes share the same ID.

For **Country Codes**, the preferred source is a `data-code`, `data-abbr`, or `data-label` attribute on each SVG region. Alphabetic suffixes such as `PH-NEC` are safe automatic fallbacks. If a map uses numeric/raw IDs that do not contain a human-facing abbreviation, add that country mapping to `manager/region-metadata.js`. The manager will flag unresolved codes for review rather than inventing an abbreviation.

You do not need to import hotspots at the same time. A country can be created with only its SVG and populated later.

## Replacing a country SVG

Open **More → Replace country SVG**. The replacement SVG is staged as an unsaved change. Existing hotspots are regenerated from their stored latitude/longitude and checked against the province IDs in the new SVG.

Run **Validate country** after replacing an SVG. This catches province IDs that no longer exist and markers that now fall inside a different province.

## Validation and Issues

Use **Validate country** beside **Import Excel** for the country you are editing. Use **Issues** in the header for a project-wide view grouped by country. The Issues button itself carries the current green/yellow/red status instead of showing a separate repository-status indicator.

The Issues dialog has a fixed responsive size. Its summary and **All / Blocking / Review** filters stay visible while the issue list scrolls independently, even with large issue counts. Clicking an issue opens the correct country or hotspot and highlights the affected field/section when one is known.

Validation checks required fields, coordinate bounds and likely latitude/longitude swaps, province geometry/mismatches, possible duplicate facilities, missing or oversized active images, duplicate image references/content, truly unlinked image files, and map consistency. Optional city/region or description fields do not create issues, and facilities are not warned simply because their real-world coordinates are physically close. Photos intentionally switched to **Unused** remain managed and are not treated as orphaned files.

Yellow warnings are review items and do not block saving. Red errors do.

## Unsaved changes and recovery

When there are pending changes, the fixed-width **Review changes** control gains an amber status dot; no extra header text is inserted, so the toolbar does not shift. Switching countries asks whether you want to stay, discard the pending changes, or review them first.

**Discard changes** reloads the current repository files and removes temporary staged files. Closing/reloading the browser also warns when there are unsaved changes.

If you are unsure about an edit, do not choose **Apply changes**. Discard the pending changes and reopen the country from the repository.

## What **Apply changes** writes to the repository

The manager edits the local repository only. It does not commit or push anything to GitHub. **Apply changes** writes the pending manager state to disk, and then you decide what to commit.

### The file that is always updated

`data/catalog.js` is rewritten every time **Apply changes** succeeds. This is the main content file for the public maps. It contains the country entries and their hotspot data, including titles, descriptions, coordinates, province/state assignments, image paths, map settings, and other saved hotspot information.

**Always commit `data/catalog.js` after applying manager changes.** If you add or edit a hotspot but do not commit this file, that content will not appear on the website.

### Country SVG files

A country's map SVG normally lives at:

`images/<country-slug>/<country-slug>.svg`

For example:

`images/thailand/thailand.svg`

The manager writes an SVG file when you **create a new country** or choose **More → Replace country SVG**. Existing SVG files are not rewritten just because you edit hotspots.

If a new or replacement SVG appears in the Git changes, commit it together with `data/catalog.js`. Do not delete a country's SVG while that country still exists in the catalog; the public map needs it to draw the country and place hotspots.

### Hotspot image files

Hotspot photos live under the country's image directory, usually in a generated hotspot folder such as:

`images/thailand/ayutthaya_example_hospital/photo.jpg`

Adding, reducing, replacing, or deleting photos can therefore create file changes under `images/<country-slug>/...`. Commit those changed image files together with `data/catalog.js`.

A photo marked **Unused** is different from a deleted photo. Unused photos remain in the repository so they can be enabled again later. Do not delete an unused file unless you actually want to remove that image from the project.

The catalog stores the image paths used by each hotspot. If `data/catalog.js` references an image that you forgot to commit, the website will have a broken/missing photo. If you commit a new image but forget the matching `data/catalog.js` change, the file may exist in the repository but the public map will not know to use it.

### Region-code metadata

`manager/region-metadata.js` is **not** automatically rewritten when you save normal country/hotspot edits. It only needs to be committed when you intentionally edit the region-label mappings, for example when a new SVG uses numeric/raw region IDs and needs human-facing Country Codes.

This file affects the manager's editing labels, not the hotspot content itself.

### Files you normally should not see changed

Normal map-content editing should not require changes to `index.html`, `data/main.js`, the manager application files, or the launch/server files. Those are application/runtime files rather than country content. If they appear in Git changes after you only edited a country or hotspot, review the diff before committing.

### What to commit in common cases

| What you did | Files that should normally be committed |
| --- | --- |
| Edited hotspot text, coordinates, province/state, or Used/Unused image state | `data/catalog.js` |
| Added a hotspot with new photos | `data/catalog.js` + the new files under `images/<country-slug>/...` |
| Added photos to an existing hotspot | `data/catalog.js` + the new image files |
| Reduced/replaced a photo | `data/catalog.js` + the changed image file(s) if their path/content changed |
| Deleted a photo | `data/catalog.js` + the image deletion shown by Git |
| Created a new country | `data/catalog.js` + `images/<country-slug>/<country-slug>.svg` + any added country images |
| Replaced a country SVG | `data/catalog.js` + the replacement SVG |
| Added/changed custom Country Code mappings | `manager/region-metadata.js` |

### Before pushing

After **Apply changes**, check your Git diff/status. At minimum, `data/catalog.js` should normally be present. Also include every SVG/image addition, modification, or deletion that belongs to the change. Commit those files and push normally; the existing GitHub Action then publishes the updated website.

A useful rule is: **if the catalog points to a file, that file must exist in the committed repository too.** Keep each country's SVG and every image you still reference.

## Direct country links

Each country header shows its share route, for example `case-map/#thailand`. The route is generated automatically from the repository name and the country's slug. You can click the route in the manager to copy it.
