# Interactive Project Maps

A browser-based interactive map for showing project locations, with a local **Project Map Manager** for maintaining countries, hotspots, photos, and map data without editing JavaScript by hand.

The repository has two main parts:

| Part | Purpose |
|---|---|
| **Public map** | The website visitors use to browse countries, project locations, photos, and project details. |
| **Project Map Manager** | A local browser-based tool used to add or update countries, hotspots, coordinates, photos, and other map content. |

The public map is built with vanilla JavaScript and D3.js. There is no application backend or build process required.

---

## Start Here

### If you want to update the map

Use the **Project Map Manager**.

Windows:

```text
launcher.bat
```

macOS:

```text
launcher.command
```

Start it from the repository root:

```text
python launcher.py
```

The manager opens locally in your browser and works directly with the checked-out repository on your computer.

> **Important:** The manager does not commit, push, or deploy anything to GitHub automatically.

For detailed instructions, see **[USER_GUIDE.md](USER_GUIDE.md)**.

---

## Normal Workflow

Most updates follow the same process:

1. Start the Project Map Manager.
2. Choose the country you want to work on.
3. Import the standard Excel file, add a hotspot manually, or edit an existing hotspot.
4. Add or manage photos.
5. Check the marker position in the Map editor.
6. Select **Validate country** and fix any problems. Use **Issues** in the header when you want the project-wide view.
7. Select **Review changes**.
8. Select **Apply changes** when everything looks correct.
9. Review the Git changes.
10. Commit and push using the normal Git workflow.

The existing GitHub Action handles publishing the updated website after the changes are pushed.

### When are files actually changed?

Edits remain pending inside the manager until you select **Apply changes**.

This includes:

- hotspot edits
- imported Excel data
- image changes
- image reductions
- SVG replacements
- deletions

If you are unsure about an edit, you can discard the pending changes and reload the current repository files.

---

## Validation and Issues

Use **Validate country** beside **Import Excel** while editing a country. The header **Issues** button is the project-wide tracker and groups blocking/review items by country.

The manager uses three status levels:

| Status | Meaning |
|---|---|
| 🟢 **Green — Valid** | Required information is present and no review issue was found. |
| 🟡 **Yellow — Needs review** | The item can still be saved, but something should be checked. |
| 🔴 **Red — Invalid** | A required value is missing or invalid. The problem must be fixed before changes can be applied. |

Validation checks required fields, coordinates, province/state matching, possible duplicate facilities, image issues, and map consistency. Optional city/region text and physically close facilities are not treated as issues.

---

## Managing Hotspots

A hotspot represents a project or facility shown on the map.

The required information is:

- Facility name
- Latitude
- Longitude
- Province/state

The manager automatically generates the SVG `x/y` position from the latitude and longitude.

Other information such as city/region, year, address, description, and photos is optional.

### Excel Import

Select **Import Excel** while the correct country is active.

The standard spreadsheet can contain:

```text
Country
City
Hospital Name
Year
Address
Case Description
Latitude
Longitude
Image
```

The `Image` column is only used as a cutoff marker. Photos are added separately through the manager.

When an updated spreadsheet is imported, existing hotspots are compared with the imported rows and shown as:

```text
New
Update
Unchanged
Conflict
```

Existing photos are preserved when a hotspot is updated.

---

## Photos

Photos can be dragged directly onto a hotspot or added with **Add images**.

A preferred maximum of **4 MB per image** is used as a warning threshold.

Images are never reduced automatically. Reduction only happens when you explicitly choose **Reduce** for an image.

Photos can also be marked:

- **Used** — appears in the public hotspot carousel.
- **Unused** — remains in the project but is hidden from the public map.

When a hotspot has multiple used images, the public map automatically displays them as a carousel.

---

## Map Editor

The Map editor lets you visually check and correct hotspot positions.

You can:

- zoom with the `+` and `−` controls
- use **Fit** to return to the full-country view
- drag the map to pan
- hover over hotspots to inspect them
- drag hotspots to correct their location

Moving a hotspot updates its latitude, longitude, SVG position, and detected province/state together. The editor overlays each province/state with its SVG region code so marker placement is easier to verify.

**Reset selected** restores only the selected hotspot's geographic position and province/state to its editing baseline. Text and image changes are not removed.

---

## Adding a New Country

Use the `+` button beside **Countries**.

A new country requires:

```text
Country name
Country slug (lowercase letters and hyphens only; used for link/url)
SVG map
```

The manager reads the SVG geographic bounds, dimensions, and province/state IDs automatically.

Hotspots do not need to be added immediately. A country can be created with only its SVG and populated later.

---

## Public Map

The public site automatically builds its landing page from the map catalog.

Users can:

- browse available country maps
- open project hotspots
- view project information and photos
- search for provinces or regions
- zoom and pan the map
- open direct links to individual countries
- view multiple nearby hotspots through cluster markers

Country pages use hash-based routes such as:

```text
#thailand
```

The Project Map Manager also displays the generated share route for the active country so it can be copied directly.

---

## Run the Public Map Locally

From the repository root:

```bash
python -m http.server
```

Then open:

```text
http://localhost:8000
```

The landing page shows all available maps. Select a country card to open its map.

---

## Repository Structure

### `data/catalog.js`

Contains the map catalog, country configuration, and hotspot data used by the public site.

### `data/main.js`

Contains the main public-map behaviour and interactions.

### `images/<country>/`

Contains the SVG map and visual assets belonging to each country.

The Project Map Manager maintains this existing structure rather than creating a separate data format.

---

## SVG Maps

Country SVG files should contain province or region paths with unique IDs.

Example:

```html
<path id="TH-10" class="state" ... />
```

MapSVG geographic metadata can also be included:

```html
<svg mapsvg:geoViewBox="97.34,5.61,105.64,20.46" ...>
```

Province names can optionally be stored with attributes such as:

```html
<path id="TH-10" data-name="Bangkok" ... />
```

The manager supports SVGs with either a normal `viewBox` or numeric width/height together with `mapsvg:geoViewBox`.

---

## Technical Notes

The public map:

- uses vanilla JavaScript
- uses D3.js v7 for SVG manipulation and interactions
- uses hash-based navigation
- requires no npm installation or build step
- works in modern versions of Chrome, Firefox, Safari, and Edge

Nearby hotspots are automatically grouped into cluster markers. Hotspots can also contain multiple images, which automatically enables the public image carousel.

The Project Map Manager writes to the same `data/catalog.js` and `images/<country>/...` structure used by the public site.

Excel `.xlsx` files are parsed locally by `app.py`.

---

## Detailed User Guide

This README is intended as the main overview of the project.

For step-by-step instructions on importing spreadsheets, editing coordinates, replacing SVGs, managing images, validation, unsaved changes, and other day-to-day tasks, see:

**[USER_GUIDE.md](USER_GUIDE.md)**

---

## License

The source code in this repository is licensed under the **MIT License**. See the `LICENSE` file for details.


### Others & Artwork

Other artwork, and visual assets (open source) included in the repository are **not covered by the MIT License unless explicitly stated otherwise**.


### Images

image files are also licensed under the MIT License.


All rights to those assets are reserved and they may not be used, copied, modified, or redistributed without permission from the copyright holder.