# Interactive Map Projects

A lightweight, hash-routed web app for displaying interactive maps with project hotspots. Built with vanilla JavaScript and D3.js, runs entirely in the browser—no backend required.

## Features

- **Multi-map support** – Add as many maps as you want using a simple catalog system
- **Hash-based routing** – Navigate between maps using URL hashes (e.g., `#thailand`)
- **Landing page** – Automatically generated card grid from your map catalog
- **Interactive hotspots** – Click to see project details with photos
- **Cluster markers** – Nearby hotspots automatically merge into a single circle showing a count. Click the circle to see all locations, then click a name to open its detail popup
- **Image carousel** – Add multiple photos to any hotspot and the popup shows ← → navigation buttons automatically
- **Zoom & pan** – Ctrl/Cmd + scroll to zoom, drag to pan
- **Search** – Find provinces/regions with autocomplete suggestions
- **Responsive** – Works on desktop, tablet, and mobile

## Quick Start

1. **Start a local server:**
   ```bash
   python -m http.server
   ```

2. **Open in browser:**
   ```
   http://localhost:8000
   ```

3. **Navigate:**
   - Landing page shows all available maps
   - Click a card to view that map
   - Click "← All Maps" to return to landing

## Project Structure

```
├── index.html              # Main HTML file
├── /data
│   ├── catalog.js         # Map catalog and configuration
│   ├── main.js            # Core map logic and interactions
│   └── styles.css         # All styles
└── /images
    └── /thailand          # Map-specific assets
        ├── thailand.svg   # SVG map file
        ├── logo-02.png    # Logo image
        └── *.jpg          # Hotspot photos
```

## Adding a New Map

### 1. Prepare Your Assets

Create a folder in `/images/` for your map:
```
/images
  └── /vietnam
      ├── vietnam.svg
      ├── logo.png
      └── [hotspot photos].jpg
```

### 2. Add to Catalog

Open `data/catalog.js` and add a new entry:

```javascript
const MAP_CATALOG = {
    thailand: { /* existing entry */ },
    
    // Add your new map here
    vietnam: {
        title: 'Projects in Vietnam',
        svgUrl: 'images/vietnam/vietnam.svg',
        logoUrl: 'images/vietnam/logo.png',
        logoAlt: 'Company Logo',
        thumbnail: 'images/vietnam/vietnam.svg',
        description: 'Brief description for the landing card.',
        
        // Geographic bounds (must match SVG's mapsvg:geoViewBox)
        geoBounds: {
            minLon: 102.14,
            maxLat: 23.39,
            maxLon: 109.46,
            minLat: 8.56
        },
        
        // Color scheme (HSL values)
        colorConfig: {
            baseHue: 175,
            sat: '50%',
            minLight: 75,
            maxLight: 85
        },
        
        // Project locations
        hotspots: [
            {
                provinceId: 'VN-01',        // SVG path ID
                title: 'Hospital Name',
                description: 'Project details here.',
                x: 123.45,                  // SVG viewBox coordinates
                y: 678.90,
                imageUrl: 'images/vietnam/hospital.jpg'
            }
            // Add more hotspots...
        ]
    }
};
```

## Hotspot Features

### Cluster Markers

Hotspots that are close together on the map are automatically grouped into a single blue circle with a number badge - no extra configuration needed.

**How it works:**
- On page load, every hotspot is checked against its neighbours
- Any two hotspots within **8 SVG units** of each other are merged into one cluster circle
- The badge shows how many locations are inside

**Interaction:**
1. Hover the cluster circle → a tooltip shows e.g. *"4 nearby hospitals"*
2. Click the cluster circle → a popup lists all the hospital names
3. Click a name → the normal detail popup opens for that location

**Adjusting the threshold:**

Open `data/main.js` and change this constant near the top of the hotspot section:

```javascript
const CLUSTER_THRESHOLD_VB = 8;  // increase to group more aggressively, decrease to split them up
```

---

### Multiple Images (Carousel)

Any hotspot can show more than one photo. When two or more images are listed the popup automatically adds ← → buttons and a counter (*"1 / 3"*). Single-image hotspots using the existing `imageUrl` field are completely unaffected.

```javascript
// Before - single image, no arrows
{
    title: 'Kumphawapi Hospital',
    imageUrl: 'images/thailand/udon_thani.jpg',
    x: 382.822, y: 231.766
}

// After - carousel with three photos, arrows appear automatically
{
    title: 'Kumphawapi Hospital',
    images: [
        'images/thailand/udon_thani.jpg',
        'images/thailand/udon_thani_ward.jpg',
        'images/thailand/udon_thani_equipment.jpg'
    ],
    x: 382.822, y: 231.766
}
```

> **Note:** If both `images` and `imageUrl` are present on the same entry, `images` takes priority. You can keep `imageUrl` while you add photos gradually.

---

## SVG Map Requirements

Your SVG file should have:

1. **Province/region paths** with unique IDs:
   ```html
   <path id="TH-10" class="state" ... />
   <path id="VN-HN" class="state" ... />
   ```

2. **Optional: Geographic metadata** in the SVG root:
   ```html
   <svg mapsvg:geoViewBox="97.34,5.61,105.64,20.46" ...>
   ```

3. **Optional: Province names** as attributes:
   ```html
   <path id="TH-10" data-name="Bangkok" ... />
   ```

## Configuration Tips

### Hotspot Coordinates

Hotspot `x` and `y` values use SVG viewBox units. To find coordinates:
1. Open your SVG in a browser
2. Open browser console
3. Click where you want the hotspot
4. Run: `document.querySelector('svg').addEventListener('click', e => console.log(e.offsetX, e.offsetY))`

### Color Schemes

Each map can have its own color palette defined in `colorConfig`:
- `baseHue`: 0-360 (e.g., 175 for blue-green, 200 for blue)
- `sat`: Saturation percentage
- `minLight` / `maxLight`: Lightness range for province shading

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires JavaScript enabled
- No Internet Explorer support

## Dependencies

- **D3.js v7** – Loaded from CDN for SVG manipulation and interactions
- No build tools or npm required

## License

The source code in this repository is licensed under the MIT License.
See the `LICENSE` file for details.

### Assets / Images

All images, artwork, and other visual assets included in this repository
are **NOT** covered by the MIT License, **except where explicitly stated otherwise**.

All rights to these assets are reserved. They may not be used, copied,
modified, or redistributed without explicit written permission from the
copyright holder.

#### SVG Map Files

The SVG files used as maps **are licensed under the MIT License**
and may be used under the same terms as the source code.
