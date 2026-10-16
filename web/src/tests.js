// Report templates for the lab desk. Synthetic values only; the lab can edit them before sealing.
// low/high draw the reference bar; `ref` is the printed reference text.
export const TESTS = {
  genotype: {
    title: "Genotype & blood group", sample: "Whole blood (EDTA)",
    blurb: "The certificate couples are asked for before marriage. Easy to fake on paper.",
    results: [
      { name: "Haemoglobin genotype", value: "AA", ref: "AA · AS · SS · AC" },
      { name: "ABO blood group", value: "O", ref: "" },
      { name: "Rhesus (D)", value: "Positive", ref: "" },
    ],
  },
  malaria: {
    title: "Malaria parasite", sample: "Whole blood",
    blurb: "Asked for by employers, schools and travel desks.",
    results: [
      { name: "P. falciparum antigen (RDT)", value: "Not detected", ref: "Not detected" },
      { name: "Parasite density (microscopy)", value: "0", unit: "/µL", ref: "0" },
    ],
  },
  fbc: {
    title: "Full blood count", sample: "Whole blood (EDTA)",
    blurb: "The everyday panel.",
    results: [
      { name: "Haemoglobin", value: "13.8", unit: "g/dL", low: 13, high: 17 },
      { name: "White cell count", value: "6.2", unit: "×10⁹/L", low: 4, high: 11 },
      { name: "Platelets", value: "250", unit: "×10⁹/L", low: 150, high: 400 },
      { name: "Haematocrit", value: "41", unit: "%", low: 40, high: 52 },
    ],
  },
  hba1c: {
    title: "Diabetes screen", sample: "Whole blood + fasting plasma",
    blurb: "Insurers and employers ask for it.",
    results: [
      { name: "HbA1c", value: "5.4", unit: "%", low: 4, high: 5.6 },
      { name: "Fasting glucose", value: "88", unit: "mg/dL", low: 70, high: 99 },
    ],
  },
  hiv: {
    title: "HIV 1/2 screen", sample: "Serum",
    blurb: "The most private result there is. Nothing about it is public on Arkiv.",
    results: [{ name: "HIV-1/2 antibody + p24 antigen", value: "Non-reactive", ref: "Non-reactive" }],
  },
}
