/** Published portfolio examples, not customer testimonials or promised finished products. */
export const PROJECTS = [
  {
    slug: 'ioniq-console-organizer', category: 'fit', label: 'Made to fit', title: 'A place for everything.', subtitle: 'An organizer made for this console.', name: 'Ioniq 5 console organizer',
    image: '/assets/images/projects/ioniq-console-organizer.png', media: 'Printed & in use', alt: 'Printed Ioniq 5 console organizer fitted in the car, with sunglasses in a compartment',
    summary: 'Not an almost-fit alternative. Pockets, proportions, and a place for the things that travel with you.',
    problem: 'An off-the-shelf organizer only helps when it fits the space and the things you keep there.',
    solution: 'This published design uses configurable pockets, wall thickness, chamfers, tolerances, and splits for different build volumes.',
    takeaway: 'The same approach can start with the dimensions of your drawer, console, desk, or other awkward space. Your fit and requirements would be reviewed separately.',
    tags: ['Parametric design', 'Fitted storage', 'Automotive'], intent: 'custom', source: 'https://cults3d.com/en/3d-model/game/fully-parametric-ioniq-5-center-console-organizer', sourceLabel: 'Design files on Cults3D'
  },
  {
    slug: 'esp32-rfid-dashboard', category: 'electronics', label: 'Electronics', title: 'From circuit board to desktop.', subtitle: 'A proper home for a working idea.', name: 'ESP32 touchscreen dashboard case',
    image: '/assets/images/projects/esp32-rfid-dashboard.jpg', media: 'Printed & in use', alt: 'Printed blue ESP32-S3 touchscreen dashboard case showing time, temperature, and battery status',
    summary: 'A screen you can use. Ports you can reach. Electronics that belong on a desk, not in a tangle of wires.',
    problem: 'A working electronics project still needs a case that lets its screen, connectors, and controls do their jobs.',
    solution: 'The catalog design accounts for the display opening, board standoffs, connectors, RFID placement, and access for assembly.',
    takeaway: 'Bring a board model, a sketch, or dimensions to start discussing an enclosure for your own project. Electronics are not included in a case inquiry.',
    tags: ['ESP32-S3', 'Touchscreen', 'Enclosure design'], intent: 'custom', source: 'https://www.printables.com/model/1745185-esp32-s3-28-touchscreen-rfid-dashboard-case', sourceLabel: 'Design files on Printables'
  },
  {
    slug: 'ender-skr2-pi-housing', category: 'printer', label: 'Printer upgrades', title: 'Everything in its right place.', subtitle: 'More than a box around the boards.', name: 'Ender controller + Raspberry Pi housing',
    image: '/assets/images/projects/ender-skr2-pi-housing.png', media: 'CAD render', alt: 'CAD render of an Ender 3 Pro controller housing with a Raspberry Pi 4 mount, vented lids, and accessible ports',
    summary: 'A controller, a Raspberry Pi, and all those cables. Designed with cooling and the next repair in mind.',
    problem: 'A printer upgrade changes more than the electronics. The boards, cooling, wires, and access all need to work together.',
    solution: 'This Ender 3 Pro enclosure brings an SKR 2 controller and Raspberry Pi 4 together while considering airflow, fastening, and service access.',
    takeaway: 'For a printer project, begin with the machine model and what you want to change. Compatibility and safe installation need individual review.',
    tags: ['Ender 3 Pro', 'SKR 2 + Pi 4', 'Serviceable design'], intent: 'repair', source: '/portfolio.html', sourceLabel: 'Original portfolio entry'
  }
];
export const INTENT_LABELS = { unknown: 'Not sure yet', replace: 'Replace a part', custom: 'Make something custom', print: 'Print a model', repair: 'Fix my printer', business: 'For my business' };
