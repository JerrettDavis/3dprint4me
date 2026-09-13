export const SITE_CONFIG = Object.freeze({
  brand: "3dprint4.me",
  owner: "Jerrett Davis",
  city: "Tulsa, Oklahoma",
  email: "hello@3dprint4.me",
  phone: "",
  typicalTurnaround: "Under 5 business days",
  maxUploadBytes: 25 * 1024 * 1024,
  maxFiles: 8,
  profiles: {
    printables: "https://www.printables.com/@Jdsfighter",
    cults: "https://cults3d.com/en/users/JerrettDavis/3d-models",
    thingiverse: "https://www.thingiverse.com/thing:6230499"
  },
  defaults: { locale: "en-US", currency: "USD", taxIncluded: false, shippingIncluded: false },
  pricing: {
    print: {
      setup: 12,
      machineHour: 2.2,
      minimum: 15,
      materialPerGram: { pla: 0.11, petg: 0.13, asa: 0.16, tpu: 0.19, other: 0.17 },
      qualityMultiplier: { draft: 0.88, standard: 1, fine: 1.35 },
      sizeFallback: {
        tiny: { grams: 25, hours: 1.2 },
        palm: { grams: 75, hours: 3.5 },
        hand: { grams: 150, hours: 7 },
        shoebox: { grams: 420, hours: 18 },
        large: { grams: 850, hours: 34 }
      },
      colorsAdd: { 1: 0, 2: 6, 3: 10, 4: 16 },
      finishAdd: { none: 0, cleanup: 6, sanded: 24, painted: 48 },
      quantityDiscount: [
        { min: 20, multiplier: 0.78 },
        { min: 10, multiplier: 0.84 },
        { min: 5, multiplier: 0.9 },
        { min: 2, multiplier: 0.95 }
      ]
    },
    design: {
      hourly: 65,
      deliverableAdd: { stl: 0, step: 15, source: 35 },
      complexityHours: { simple: [1, 2.5], fitted: [2.5, 5], assembly: [5, 10], complex: [9, 18] },
      sourceMultiplier: { cad: 0.85, dimensions: 1, photos: 1.2, concept: 1.35 }
    },
    repair: { diagnostic: [49, 69], tune: [79, 129], repair: [89, 189], rebuild: [175, 425] },
    consult: { halfHour: [35, 35], hour: [65, 65], onsite: [95, 145], printerDesign: [250, 950] },
    delivery: { pickup: 0, local: 15, shipping: 18 }
  }
});

export const SERVICE_LABELS = Object.freeze({
  print: "Print my model",
  design: "Design something for me",
  repair: "Repair or tune my printer",
  consult: "Consulting or printer design"
});
