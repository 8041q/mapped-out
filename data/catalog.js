// MAP_CATALOG — Central lookup table for all maps.
// Each key is a URL hash slug (e.g. #thailand → MAP_CATALOG['thailand']).
// Entries are loaded on demand (no preloading or hardcoded <img> tags).
// To add a map: create /images/<slug>/ with the SVG and images, then add an entry below.

const MAP_CATALOG = {

    thailand: {
        title: 'Hospital Projects in Thailand',
        svgUrl: 'images/thailand/thailand.svg',
        logoUrl: 'images/thailand/logo-02.png',
        logoAlt: 'Saikang Medical Logo',
        thumbnail: 'images/thailand/thailand.svg',   // used on landing card
        description: 'Saikang Medical hospital bed and equipment supply projects across Thailand.',

        // Geographic bounding box — must match the SVG's mapsvg:geoViewBox
        geoBounds: {
            minLon: 97.344728,
            maxLat: 20.463430,
            maxLon: 105.640023,
            minLat: 5.614417
        },

        // Per-map color scheme (HSL)
        colorConfig: {
            baseHue: 175,
            sat: '50%',
            minLight: 75,
            maxLight: 85
        },

        // Hotspots — coordinates are in SVG viewBox units
        hotspots: [
            {
                provinceId: 'TH-41',
                title: 'Kumphawapi Hospital',
                description: '180-bed hospital. Saikang supplied hospital beds, bedside tables and overbed tables for new wards.',
                x: 382.822,
                y: 231.766,
                images: ['images/thailand/udon_kum/udon_thani.jpg',
                    'images/thailand/udon_kum/1.png',
                    'images/thailand/udon_kum/2.png',
                    'images/thailand/udon_kum/3.png',
                    'images/thailand/udon_kum/4.png',
                    'images/thailand/udon_kum/5.png',
                ]
            },
            {
                provinceId: 'TH-36',
                title: 'Kaengkhro Hospital',
                description: 'Public hospital with 300 beds. Saikang electric beds provide safety and comfort for patients.',
                x: 331.438,
                y: 300.624,
                images: ['images/thailand/kaengkhro/chaiyaphum.jpg']
            },
            {
                provinceId: 'TH-10',
                title: 'King Chulalongkorn Memorial Hospital',
                description: 'Public general and tertiary referral hospital with 1,435 beds. Saikang supplied medical trolleys to support clinical operations.',
                x: 216.493,
                y: 472.861,
                images: ['images/thailand/bangkok_king-chu/bangkok_chu.jpg',
                    'images/thailand/bangkok_king-chu/1.png',
                    'images/thailand/bangkok_king-chu/2.png']
            },
                        {
                provinceId: 'TH-10',
                title: 'Police General Hospital',
                description: 'A police hospital for the Royal Thai Police, equipped with the Saikang hospital beds of GB8e8y.',
                x: 218.993,
                y: 469.261,
                images: ['images/thailand/bangkok_policeGen/1.png',
                    'images/thailand/bangkok_policeGen/2.png',
                    'images/thailand/bangkok_policeGen/3.png']
            },
            {
                provinceId: 'TH-10',
                title: 'Phyathai 1 Hospital',
                description: 'Private hospital group. Medical trolleys are used in their pediatric department and OB rooms.',
                x: 216.093,
                y: 469.861,
                images: ['images/thailand/bangkok_phyathai/1.jpeg',
                    'images/thailand/bangkok_phyathai/2.jpeg']
            },
            {
                provinceId: 'TH-10',
                title: 'Chulalongkorn HP',
                description: 'Public hospital, Medical trolleys used in this hospital.',
                x: 219.493,
                y: 472.061,
                images: ['images/thailand/bangkok_chuHP/1.jpeg',
                    'images/thailand/bangkok_chuHP/2.jpeg']
            },
            {
                provinceId: 'TH-10',
                title: 'The Blessing Nursing Home & Rehab',
                description: 'Nursing home and rehabilitation center using Saikang electric beds to ensure daily safety and care for the elderly.',
                x: 225,
                y: 472,
                images: ['images/thailand/bangkok_bless/bangkok_bless.jpg',
                    'images/thailand/bangkok_bless/1.png',
                    'images/thailand/bangkok_bless/2.png']
            },
            {
                provinceId: 'TH-81',
                title: 'Khlong Thom Hospital',
                description: 'Multispecialty hospital using Saikang electric beds and accessories to support patient care.',
                x: 128,
                y: 870,
                images: ['images/thailand/krabi_khlong/krabi.jpg',
                    'images/thailand/krabi_khlong/1.png']
            },
            {
                provinceId: 'TH-43',
                title: 'Subdistrict Health Promotion Center',
                description: 'In Nong Khai, primary health services are delivered by 74 sub-district health promoting hospitals (SHPHs) operated by the Ministry of Public Health rather than a single center. These hospitals provide maternal, elderly, and chronic disease care under Thailand\'s Universal Coverage Scheme. Saikang supplied 180 pcs of V3v manual hospital beds for these centers.',
                x: 364.246,
                y: 185.112,
                images: ['images/thailand/nong_subHealth/1.jpeg',
                    'images/thailand/nong_subHealth/2.jpeg',
                    'images/thailand/nong_subHealth/3.jpeg',
                    'images/thailand/nong_subHealth/4.jpeg',]
            },
            {
                provinceId: 'TH-30',
                title: 'National Blood Service Region 5, Thai Red Cross',
                description: 'Thai Red Cross project. Dialysis chairs SKE-136 used in their organisation.',
                x: 324.532,
                y: 385.677,
                images: ['images/thailand/nakhon_redCross/3.jpeg',
                    'images/thailand/nakhon_redCross/1.jpeg',
                    'images/thailand/nakhon_redCross/2.jpeg',
                    'images/thailand/nakhon_redCross/4.jpeg',]
            },
            {
                provinceId: 'TH-73',
                title: 'Dontu Hospital',
                description: 'Private hospital. Patient trolley SKB041-1 used in this hospital.',
                x: 186.093,
                y: 454.845,
                images: ['images/thailand/nakhon_dontu/2.jpeg',
                    'images/thailand/nakhon_dontu/1.jpeg']
            },
            {
                provinceId: 'TH-40',
                title: 'Nakhon Phanom Provincial Administrative',
                description: 'Private Hospital, 145 pcs manual bed two cranks K2k used in this hospital.',
                x: 371.629,
                y: 282.101,
                images: ['images/thailand/nakhon_phanom/1.jpeg']
            },
            {
                provinceId: 'TH-90',
                title: 'Songklanagarind Hospital',
                description: 'Songklanagarind Hospital is a university teaching hospital affiliated with the Faculty of Medicine at Prince of Songkla University, located in Hat Yai District, Songkhla Province. As the first university hospital in Southern Thailand, it is a super-tertiary care facility. For teaching purposes, the hospital is equipped with beds from Saikang Medical and model V3v beds.',
                x: 213,
                y: 928,
                images: ['images/thailand/songklanagarind/2.png',
                    'images/thailand/songklanagarind/1.png']
            },
            {
                provinceId: 'TH-92',
                title: 'Na Yong Hospital',
                description: 'Nayong Hospital is a primary healthcare facility located in Trang Province, Thailand. Saikang Medical supplied V6v hospital beds.',
                x: 163,
                y: 893,
                images: ['images/thailand/na-yong/1.png']
            },
            {
                provinceId: 'TH-56',
                title: 'Phayao Hospital',
                description: 'It\'s the main public hospital in Phayao Province, in northern Thailand. It serves as the primary healthcare center and plays an important role in both emergency care and general medical services for the local population. We won a 110 manual bed project here, with our model V3v.',
                x: 170,
                y: 90,
                images: ['images/thailand/phayao/6.png',
                    'images/thailand/phayao/3.jpeg',
                    'images/thailand/phayao/2.jpeg',
                    'images/thailand/phayao/4.jpeg',
                    'images/thailand/phayao/5.jpeg',
                    'images/thailand/phayao/1.jpeg']
            }
        ]
    }
    // ── Add more maps here ──────────────────────────────────────────
    // vietnam: { title: '…', svgUrl: 'images/vietnam/vietnam.svg', … }
};
