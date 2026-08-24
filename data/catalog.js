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
    },
    philippines: {
        title: 'Hospital Projects in the Philippines',
        svgUrl: 'images/philippines/philippines.svg',
        logoUrl: '',
        logoAlt: '',
        thumbnail: 'images/philippines/philippines.svg',
        description: 'Saikang Medical hospital bed and equipment supply projects across the Philippines.',

        geoBounds: {
            minLon: 116.927573,
            maxLat: 20.834769,
            maxLon: 126.606549,
            minLat: 4.640292
        },

        colorConfig: {
            baseHue: 140,
            sat: '50%',
            minLight: 70,
            maxLight: 82
        },

        hotspots: [
            {
                provinceId: 'PH-PAM',
                title: 'Center for Infectious Diseases and Tropical Medicine',
                description: 'We have maintained a partnership with the Philippine Department of Health (DOH) for over a decade. Business generated from DOH accounts for 30% of our total market share in the Philippines, making it our key benchmark client among all public medical institutions.',
                x: 272.725,
                y: 433.212,
                images: ['images/philippines/pampanga_center/1.png',
                    'images/philippines/pampanga_center/2.png',
                    'images/philippines/pampanga_center/3.png']
            },
            {
                provinceId: 'PH-AGN',
                title: 'Allied Care Experts Medical Center Inc',
                description: 'ACE Group stands as our flagship private hospital partner. We have established a long-term and stable cooperative relationship since we commenced collaboration back in 2022.',
                x: 625.024,
                y: 888.848,
                images: ['images/philippines/butuan_allied_care/1.png',
                    'images/philippines/butuan_allied_care/2.png',
                    'images/philippines/butuan_allied_care/3.jpeg']
            },
            {
                provinceId: 'PH-MNL',
                title: 'Ospital ng Paranaque hospital',
                description: 'Ospital ng Parañaque (OsPar) is a leading public tertiary hospital in Parañaque City, Metro Manila, owned and operated by the Parañaque City Government.',
                x: 297.3,
                y: 474.0,
                images: ['images/philippines/manila_paranaque_hospital/1.png',
                    'images/philippines/manila_paranaque_hospital/2.png',
                    'images/philippines/manila_paranaque_hospital/3.png']
            },
            {
                provinceId: 'PH-SLU',
                title: 'Parang district hospital',
                description: 'Parang District Hospital is a public district medical institution in Parang, Sulu, the Philippines, delivering standardized medical and healthcare services for local residents and surrounding communities.',
                x: 288.748,
                y: 1114.334,
                images: ['images/philippines/sulu_parang_hospital/1.png',
                    'images/philippines/sulu_parang_hospital/2.png']
            },
            {
                provinceId: 'PH-MSR',
                title: 'New MMG Hospital',
                description: 'New Medical Mission Group Hospital (New MMG Hospital) is a private Level II general hospital in Solano, Nueva Vizcaya, Philippines, offering secondary healthcare services under the MMG Federation.',
                x: 531.219,
                y: 942.158,
                images: ['images/philippines/cagayan_mission_group/1.png',
                    'images/philippines/cagayan_mission_group/2.png']
            },
            {
                provinceId: 'PH-CAG',
                title: 'Cagayan Valley Medical Center',
                description: 'The Cagayan Valley Medical Center started from an army tent. Immediately after the war in 1945, the 37th Infantry put up the 43rd Filed Hospital that came from Pangasinan under Major Anderson of the United State Marine Corps (USMC) treating both Filipino and American soldiers.',
                x: 346.8,
                y: 240.4,
                images: ['images/philippines/cagayan_valley_medical/1.png',
                    'images/philippines/cagayan_valley_medical/2.png',
                    'images/philippines/cagayan_valley_medical/3.png',
                    'images/philippines/cagayan_valley_medical/4.png',
                    'images/philippines/cagayan_valley_medical/5.png']
            },
            {
                provinceId: 'PH-BAN',
                title: 'Bataan General Hospital and Medical Center',
                description: 'Bataan General Hospital and Medical Center (BGHMC) is a Level III tertiary, teaching and training hospital under the Department of Health (DOH), located in Balanga City, Bataan.',
                x: 261.528,
                y: 459.794,
                images: ['images/philippines/bataan_general_hospital/1.png',
                    'images/philippines/bataan_general_hospital/2.png',
                    'images/philippines/bataan_general_hospital/3.png',
                    'images/philippines/bataan_general_hospital/4.png']
            },
            {
                provinceId: 'PH-MSR',
                title: 'New Medical Mission Group Hospital',
                description: 'New Medical Mission Group Hospital (New MMG Hospital) is a private Level II general hospital in Solano, Nueva Vizcaya, Philippines, offering secondary healthcare services under the MMG Federation.',
                x: 531.219,
                y: 942.158,
                images: ['images/philippines/cagayan_nmg_hospital/1.jpeg',
                    'images/philippines/cagayan_nmg_hospital/2.jpeg',
                    'images/philippines/cagayan_nmg_hospital/3.jpeg',
                    'images/philippines/cagayan_nmg_hospital/4.jpeg']
            },
            {
                provinceId: 'PH-QUE',
                title: 'East Avenue Medical Center (EAMC)',
                description: 'EAMC is a 1000-bed Level-3 government tertiary hospital under the Philippine Department of Health, located in Diliman, Quezon City.',
                x: 298.984,
                y: 462.425,
                images: ['images/philippines/manila_eamc/1.jpeg',
                    'images/philippines/manila_eamc/2.jpeg',
                    'images/philippines/manila_eamc/3.png',
                    'images/philippines/manila_eamc/4.png',
                    'images/philippines/manila_eamc/5.jpeg']
            },
            {
                provinceId: 'PH-BEN',
                title: 'Saint Louis University',
                description: 'Founded in 1911 by CICM missionaries, Saint Louis University is the largest private Catholic university in Northern Luzon, Philippines, located in the cool mountain city of Baguio.',
                x: 266.372,
                y: 329.812,
                images: ['images/philippines/benguet_saint_louis_uni/1.png',
                    'images/philippines/benguet_saint_louis_uni/2.png',
                    'images/philippines/benguet_saint_louis_uni/3.png']
            },
            {
                provinceId: 'PH-QUE',
                title: 'National Kidney and Transplant Institute',
                description: 'National Kidney and Transplant Institute the Philippines. The National Kidney and Transplant Institute (NKTI) is a government-owned and controlled corporate tertiary specialty center attached to the Department of Health.',
                x: 298.984,
                y: 462.113,
                images: ['images/philippines/manila_kidney_transplant/1.png',
                    'images/philippines/manila_kidney_transplant/2.png']
            },
            {
                provinceId: 'PH-LAG',
                title: 'AMSI Doctors',
                description: 'Inaugurated in October 2023, AMSI Doctors\' Medical Center is a modern 130-bed referral hospital in Calamba, Laguna.',
                x: 307.012,
                y: 495.084,
                images: ['images/philippines/laguna_amsi/1.png',
                    'images/philippines/laguna_amsi/2.png']
            },
            {
                provinceId: 'PH-SLU',
                title: 'IPHO Sulu Province Hospital',
                description: 'Operated under the Integrated Provincial Health Office of Sulu, this is the major public provincial hospital located in Jolo, the capital of Sulu.',
                x: 295.6,
                y: 1104.4,
                images: ['images/philippines/mindanao_ipho/1.png',
                    'images/philippines/mindanao_ipho/2.png',
                    'images/philippines/mindanao_ipho/3.png',
                    'images/philippines/mindanao_ipho/4.png']
            },
            {
                provinceId: 'PH-MNL',
                title: 'Chinese General Hospital and Medical Center',
                description: 'Founded in 1891 with donations from Filipino-Chinese community, CGHMC is one of Manila\'s oldest non-profit tertiary teaching hospitals.',
                x: 294.728,
                y: 463.742,
                images: ['images/philippines/manila_cghmc/1.png']
            },
            {
                provinceId: 'PH-BUL',
                title: 'Bocaue Specialists Medical Center',
                description: 'Established in 2022, Bocaue Specialists Medical Center is a private community-based hospital in Bulacan province north of Metro Manila.',
                x: 291.0,
                y: 451.9,
                images: ['images/philippines/bulacan_bocaue_center/1.png',
                    'images/philippines/bulacan_bocaue_center/2.png',
                    'images/philippines/bulacan_bocaue_center/3.png']
            },
            {
                provinceId: 'PH-LEY',
                title: 'Mother of Mercy Hospital',
                description: 'It is a private Level-2 general hospital located in Tacloban, Leyte. It delivers emergency service, inpatient-outpatient care covering internal medicine, pediatrics, obstetrics-gynecology and general surgery.',
                x: 585.8,
                y: 717.3,
                images: ['images/philippines/leyte_mercy_hospital/1.png',
                    'images/philippines/leyte_mercy_hospital/2.png']
            },
            {
                provinceId: 'PH-SCO',
                title: 'Dr. Arturo R Pingoy Medical Center',
                description: 'Commonly known as Pingoy Medical Center, this private Level 2 hospital is located in Koronadal City, South Cotabato in Soccsksargen region.',
                x: 574.028,
                y: 1070.078,
                images: ['images/philippines/south_cotabato_arturo/1.png',
                    'images/philippines/south_cotabato_arturo/2.png',
                    'images/philippines/south_cotabato_arturo/3.png',
                    'images/philippines/south_cotabato_arturo/4.png']
            },
            {
                provinceId: 'PH-CEB',
                title: 'TDC (The Dialysis Co., Inc.)',
                description: 'TDC offers affordable excellent quality dialysis treatments with the latest state-of-the-art renal equipment and highly experienced medical team.',
                x: 506.384,
                y: 785.362,
                images: ['images/philippines/cebu_tdc/1.png',
                    'images/philippines/cebu_tdc/2.png',
                    'images/philippines/cebu_tdc/3.png',
                    'images/philippines/cebu_tdc/4.png']
            }
        ]
    }
    // ── Add more maps here ──────────────────────────────────────────
    // vietnam: { title: '…', svgUrl: 'images/vietnam/vietnam.svg', … }
};
