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

Use the `+` and `−` buttons in the corner to zoom and **Fit** to return to the full country. Drag the map background to pan. The mouse wheel keeps its normal page-scrolling behavior and does not zoom the map. The **Labels** control has three modes: **Off**, **Codes** (the full SVG region ID, such as `TH-81`), and **Numbers** (the compact numeric suffix, such as `81`, when the region ID has one). These labels are editor-only watermarks.

Hover a hotspot to see its facility name, city/region when available, and current coordinates. Drag a hotspot to correct its position. The latitude, longitude, SVG position, and detected province are updated together.

If you move a hotspot and want to undo only its map position, use **Reset selected**. This restores the hotspot's latitude, longitude, map position and province/state to its baseline from the last applied state. For a new/imported hotspot that has not been applied yet, it returns to the position where it was first added/imported. Text and image edits are left alone.

## Adding and managing photos

Select a hotspot and drag photos into the Images area, or choose **Add images**. New hotspot folders are generated consistently from the detected province/state name followed by the facility name. Existing folders that already contain referenced images are preserved so paths are not broken.

A preferred maximum of **4 MB per image** is used as a warning threshold. Images are never reduced automatically. Choose **Reduce** on an individual image only when you want to optimize that file.

Each photo also has a **Used / Unused** switch. **Used** photos appear in the public hotspot carousel. **Unused** photos stay in the project and can be turned back on later, but they are not shown on the public map and are not treated as orphaned files.

A reduced image is prepared in a temporary workspace first. The original repository file remains untouched until **Apply changes**. Discarding/resetting the edits removes the temporary version.

PNG files can try a lossless, pixel-preserving reduction. JPEG, WebP, and AVIF use a high-quality reduction because meaningful size savings are not truly lossless for those formats.

## Adding a new country

Choose the `+` button beside Countries. Country name, country slug, and the country SVG are required. Slugs are normalized live to lowercase letters and hyphens; uppercase characters are converted immediately and numbers are removed. The public title and description can be edited but are optional.

The manager reads the SVG geographic bounds, map size, and province/state IDs automatically. If the SVG provides width/height instead of a `viewBox`, the manager creates the equivalent preview view internally without changing the original SVG.

You do not need to import hotspots at the same time. A country can be created with only its SVG and populated later.

## Replacing a country SVG

Open **More → Replace country SVG**. The replacement SVG is staged as an unsaved change. Existing hotspots are regenerated from their stored latitude/longitude and checked against the province IDs in the new SVG.

Run **Validate country** after replacing an SVG. This catches province IDs that no longer exist and markers that now fall inside a different province.

## Validation and Issues

Use **Validate country** beside **Import Excel** for the country you are editing. Use **Issues** in the header for a project-wide view grouped by country. The Issues button itself carries the current green/yellow/red status instead of showing a separate repository-status indicator.

Validation checks required fields, coordinate bounds and likely latitude/longitude swaps, province geometry/mismatches, possible duplicate facilities, missing or oversized active images, duplicate image references/content, truly unlinked image files, and map consistency. Optional city/region or description fields do not create issues, and facilities are not warned simply because their real-world coordinates are physically close. Photos intentionally switched to **Unused** remain managed and are not treated as orphaned files.

Yellow warnings are review items and do not block saving. Red errors do.

## Unsaved changes and recovery

When there are pending changes, the fixed-width **Review changes** control gains an amber status dot; no extra header text is inserted, so the toolbar does not shift. Switching countries asks whether you want to stay, discard the pending changes, or review them first.

**Discard changes** reloads the current repository files and removes temporary staged files. Closing/reloading the browser also warns when there are unsaved changes.

If you are unsure about an edit, do not choose **Apply changes**. Discard the pending changes and reopen the country from the repository.

## After applying changes

The manager only updates files in your local repository. It does not run Git commands. After applying changes, review and commit the files, and push them normally. The existing GitHub Action continues to publish the public page and after a few minutes the new country url will be available.

## Direct country links

Each country header shows its share route, for example `case-map/#thailand`. The route is generated automatically from the repository name and the country's slug. You can click the route in the manager to copy it.
