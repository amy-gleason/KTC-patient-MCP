import { randomUUID } from "node:crypto";

/**
 * Minimal IPS-flavored types. Not a full FHIR R4 type set — just what
 * build_ips_bundle accepts as input + emits as output.
 */

export interface PatientInput {
  givenName: string;
  familyName: string;
  birthDate?: string; // YYYY-MM-DD
  gender?: "male" | "female" | "other" | "unknown";
  identifier?: { system: string; value: string }[];
}

export interface ConditionInput {
  /** Free-text label, used as fallback when no coding is provided. */
  text: string;
  snomed?: string;
  icd10?: string;
  clinicalStatus?: "active" | "recurrence" | "relapse" | "inactive" | "remission" | "resolved";
  onsetDate?: string;
  recordedDate?: string;
}

export interface MedicationInput {
  /** Free-text drug name (brand or generic). */
  text: string;
  rxnorm?: string;
  status?: "active" | "completed" | "stopped" | "intended" | "on-hold";
  dosage?: string; // e.g. "500 mg PO BID"
  asserter?: "patient" | "clinician";
}

export interface AllergyInput {
  text: string;
  snomed?: string;
  severity?: "mild" | "moderate" | "severe";
  reaction?: string;
}

export interface ProcedureInput {
  text: string;
  snomed?: string;
  cpt?: string;
  performedDate?: string;
}

export interface ObservationInput {
  text: string;
  loinc?: string;
  value?: string | number;
  unit?: string;
  effectiveDate?: string;
}

export interface ImmunizationInput {
  text: string;
  cvx?: string;
  date?: string;
}

export interface BuildIpsInput {
  patient: PatientInput;
  custodianOrganization?: { name: string };
  conditions?: ConditionInput[];
  medications?: MedicationInput[];
  allergies?: AllergyInput[];
  procedures?: ProcedureInput[];
  observations?: ObservationInput[];
  immunizations?: ImmunizationInput[];
  /** If true, dedupe medications + conditions canonically. Default true. */
  dedupe?: boolean;
  /** Drop sections that look thin (e.g. only Hep B at birth in immunizations). Default true. */
  pruneEmpty?: boolean;
  /** Sections to skip even if non-empty. */
  skipSections?: ("immunizations" | "procedures" | "results")[];
  /** If true, mark Composition.author as the Patient (patient-authored IPS). Default true. */
  patientAuthored?: boolean;
}

export interface FhirReference {
  reference: string;
  display?: string;
}

export interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirBundleEntry {
  fullUrl: string;
  resource: Record<string, unknown>;
}

export interface FhirBundle {
  resourceType: "Bundle";
  id: string;
  type: "document" | "collection";
  timestamp?: string;
  entry: FhirBundleEntry[];
}

const SYS = {
  snomed: "http://snomed.info/sct",
  loinc: "http://loinc.org",
  rxnorm: "http://www.nlm.nih.gov/research/umls/rxnorm",
  icd10cm: "http://hl7.org/fhir/sid/icd-10-cm",
  cvx: "http://hl7.org/fhir/sid/cvx",
  cpt: "http://www.ama-assn.org/go/cpt",
  cond_clinical: "http://terminology.hl7.org/CodeSystem/condition-clinical",
};

/**
 * Equivalence map for medication canonicalization. Keys are canonical lowercase
 * forms; values are arrays of brand/generic synonyms also lowercase.
 * Extend per the handoff spec.
 */
const MED_SYNONYMS: Record<string, string[]> = {
  amitriptyline: ["elavil"],
  mycophenolate: ["cellcept", "myfortic"],
  ivig: ["gamunex", "privigen", "gammagard"],
  acetaminophen: ["tylenol", "paracetamol"],
  ibuprofen: ["advil", "motrin"],
  metformin: ["glucophage"],
  lisinopril: ["zestril", "prinivil"],
  atorvastatin: ["lipitor"],
};

const COND_SYNONYMS: Record<string, string[]> = {
  juvenile_dermatomyositis: ["juvenile dermatomyositis", "jdm"],
  ulcerative_colitis: ["ulcerative colitis", "colitis", "uc"],
  trauma_history: [
    "mva",
    "motor vehicle accident",
    "post-mva",
    "post mva pain",
  ],
  type_2_diabetes: ["type 2 diabetes mellitus", "t2dm", "type 2 diabetes"],
};

function canonicalize(text: string, synonymMap: Record<string, string[]>): string {
  const norm = text.trim().toLowerCase();
  for (const [canon, syns] of Object.entries(synonymMap)) {
    const canonHuman = canon.replace(/_/g, " ");
    if (canon === norm || canonHuman === norm) return canon;
    if (norm.includes(canonHuman)) return canon;
    if (syns.includes(norm)) return canon;
    if (syns.some((s) => norm.includes(s))) return canon;
  }
  return norm;
}

function dedupeMedications(meds: MedicationInput[]): MedicationInput[] {
  const groups = new Map<string, MedicationInput[]>();
  for (const m of meds) {
    const key = canonicalize(m.text, MED_SYNONYMS);
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }
  // Prefer the entry with the longest text + dosage (most descriptive).
  const out: MedicationInput[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => (`${b.text}${b.dosage ?? ""}`.length - `${a.text}${a.dosage ?? ""}`.length));
    out.push(arr[0]);
  }
  return out;
}

function dedupeConditions(conds: ConditionInput[]): ConditionInput[] {
  // Drop CareSync junk: code.text === "Active" with no SNOMED.
  const filtered = conds.filter((c) => !(c.text.trim().toLowerCase() === "active" && !c.snomed));
  const groups = new Map<string, ConditionInput[]>();
  for (const c of filtered) {
    const key = canonicalize(c.text, COND_SYNONYMS);
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  const out: ConditionInput[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => b.text.length - a.text.length);
    out.push(arr[0]);
  }
  return out;
}

function urn(): string {
  return `urn:uuid:${randomUUID()}`;
}

function makePatient(p: PatientInput): { urn: string; resource: Record<string, unknown> } {
  const u = urn();
  return {
    urn: u,
    resource: {
      resourceType: "Patient",
      id: u.replace("urn:uuid:", ""),
      name: [{ family: p.familyName, given: [p.givenName] }],
      gender: p.gender ?? "unknown",
      birthDate: p.birthDate,
      identifier: p.identifier,
    },
  };
}

function makeCondition(c: ConditionInput, patientRef: string): FhirBundleEntry {
  const codings: FhirCoding[] = [];
  if (c.snomed) codings.push({ system: SYS.snomed, code: c.snomed, display: c.text });
  if (c.icd10) codings.push({ system: SYS.icd10cm, code: c.icd10, display: c.text });
  return {
    fullUrl: urn(),
    resource: {
      resourceType: "Condition",
      clinicalStatus: {
        coding: [
          { system: SYS.cond_clinical, code: c.clinicalStatus ?? "active" },
        ],
      },
      code: { coding: codings.length ? codings : undefined, text: c.text },
      subject: { reference: patientRef },
      onsetDateTime: c.onsetDate,
      recordedDate: c.recordedDate,
    },
  };
}

function makeMedication(m: MedicationInput, patientRef: string): FhirBundleEntry {
  const codings: FhirCoding[] = [];
  if (m.rxnorm) codings.push({ system: SYS.rxnorm, code: m.rxnorm, display: m.text });
  return {
    fullUrl: urn(),
    resource: {
      resourceType: "MedicationStatement",
      status: m.status ?? "active",
      medicationCodeableConcept: {
        coding: codings.length ? codings : undefined,
        text: m.dosage ? `${m.text} — ${m.dosage}` : m.text,
      },
      subject: { reference: patientRef },
      ...(m.asserter
        ? { informationSource: { reference: patientRef, display: "patient-authored" } }
        : {}),
    },
  };
}

function makeAllergy(a: AllergyInput, patientRef: string): FhirBundleEntry {
  const codings: FhirCoding[] = [];
  if (a.snomed) codings.push({ system: SYS.snomed, code: a.snomed, display: a.text });
  return {
    fullUrl: urn(),
    resource: {
      resourceType: "AllergyIntolerance",
      patient: { reference: patientRef },
      code: { coding: codings.length ? codings : undefined, text: a.text },
      reaction: a.reaction
        ? [
            {
              manifestation: [{ text: a.reaction }],
              severity: a.severity,
            },
          ]
        : undefined,
    },
  };
}

function makeNoKnownAllergy(patientRef: string): FhirBundleEntry {
  return {
    fullUrl: urn(),
    resource: {
      resourceType: "AllergyIntolerance",
      patient: { reference: patientRef },
      code: {
        coding: [{ system: SYS.snomed, code: "716186003", display: "No known allergy" }],
        text: "No known allergies",
      },
    },
  };
}

function makeProcedure(p: ProcedureInput, patientRef: string): FhirBundleEntry {
  const codings: FhirCoding[] = [];
  if (p.snomed) codings.push({ system: SYS.snomed, code: p.snomed, display: p.text });
  if (p.cpt) codings.push({ system: SYS.cpt, code: p.cpt, display: p.text });
  return {
    fullUrl: urn(),
    resource: {
      resourceType: "Procedure",
      status: "completed",
      code: { coding: codings.length ? codings : undefined, text: p.text },
      subject: { reference: patientRef },
      performedDateTime: p.performedDate,
    },
  };
}

function makeObservation(o: ObservationInput, patientRef: string): FhirBundleEntry {
  const codings: FhirCoding[] = [];
  if (o.loinc) codings.push({ system: SYS.loinc, code: o.loinc, display: o.text });
  return {
    fullUrl: urn(),
    resource: {
      resourceType: "Observation",
      status: "final",
      code: { coding: codings.length ? codings : undefined, text: o.text },
      subject: { reference: patientRef },
      effectiveDateTime: o.effectiveDate,
      valueQuantity:
        typeof o.value === "number" ? { value: o.value, unit: o.unit } : undefined,
      valueString: typeof o.value === "string" ? o.value : undefined,
    },
  };
}

function makeImmunization(i: ImmunizationInput, patientRef: string): FhirBundleEntry {
  const codings: FhirCoding[] = [];
  if (i.cvx) codings.push({ system: SYS.cvx, code: i.cvx, display: i.text });
  return {
    fullUrl: urn(),
    resource: {
      resourceType: "Immunization",
      status: "completed",
      vaccineCode: { coding: codings.length ? codings : undefined, text: i.text },
      patient: { reference: patientRef },
      occurrenceDateTime: i.date,
    },
  };
}

function narrative(html: string): { status: "generated"; div: string } {
  return {
    status: "generated",
    div: `<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`,
  };
}

export function buildIpsBundle(input: BuildIpsInput): FhirBundle {
  const dedupe = input.dedupe ?? true;
  const pruneEmpty = input.pruneEmpty ?? true;
  const skip = new Set(input.skipSections ?? []);

  const patient = makePatient(input.patient);
  const patientRef = patient.urn;
  const entries: FhirBundleEntry[] = [];

  // Patient first.
  entries.push({ fullUrl: patient.urn, resource: patient.resource });

  // Custodian organization.
  let custodianRef: string | undefined;
  if (input.custodianOrganization) {
    const u = urn();
    entries.push({
      fullUrl: u,
      resource: {
        resourceType: "Organization",
        name: input.custodianOrganization.name,
      },
    });
    custodianRef = u;
  }

  // Process per section.
  const conds = dedupe ? dedupeConditions(input.conditions ?? []) : input.conditions ?? [];
  const condEntries = conds.map((c) => makeCondition(c, patientRef));

  const meds = dedupe ? dedupeMedications(input.medications ?? []) : input.medications ?? [];
  const medEntries = meds.map((m) => makeMedication(m, patientRef));

  const allergyEntries = (input.allergies ?? []).map((a) => makeAllergy(a, patientRef));
  if (allergyEntries.length === 0) allergyEntries.push(makeNoKnownAllergy(patientRef));

  const procedureEntries = (input.procedures ?? []).map((p) => makeProcedure(p, patientRef));
  const observationEntries = (input.observations ?? []).map((o) =>
    makeObservation(o, patientRef),
  );
  const immunizationEntries = (input.immunizations ?? []).map((i) =>
    makeImmunization(i, patientRef),
  );

  // Push entries before composition so refs resolve in document-order.
  entries.push(...condEntries, ...medEntries, ...allergyEntries);
  if (!skip.has("procedures") && (!pruneEmpty || procedureEntries.length > 0)) {
    entries.push(...procedureEntries);
  }
  if (!skip.has("results") && (!pruneEmpty || observationEntries.length > 0)) {
    entries.push(...observationEntries);
  }
  // Per handoff: drop near-empty immunizations (e.g. only Hep B at birth).
  const immunizationsThin =
    pruneEmpty && immunizationEntries.length > 0 && immunizationEntries.length < 2;
  if (
    !skip.has("immunizations") &&
    !immunizationsThin &&
    immunizationEntries.length > 0
  ) {
    entries.push(...immunizationEntries);
  }

  // Composition (LOINC 60591-5).
  const compSections: Record<string, unknown>[] = [];
  compSections.push({
    title: "Allergies and Intolerances",
    code: { coding: [{ system: SYS.loinc, code: "48765-2" }] },
    text: narrative(
      allergyEntries.length === 1 && (allergyEntries[0].resource as { code?: { text?: string } }).code?.text === "No known allergies"
        ? "<p>No known allergies.</p>"
        : `<ul>${(input.allergies ?? []).map((a) => `<li>${escapeHtml(a.text)}${a.severity ? ` (${a.severity})` : ""}</li>`).join("")}</ul>`,
    ),
    entry: allergyEntries.map((e) => ({ reference: e.fullUrl })),
  });
  compSections.push({
    title: "Medication Summary",
    code: { coding: [{ system: SYS.loinc, code: "10160-0" }] },
    text: narrative(
      medEntries.length === 0
        ? "<p>No active medications reported.</p>"
        : `<ul>${meds.map((m) => `<li>${escapeHtml(m.text)}${m.dosage ? ` — ${escapeHtml(m.dosage)}` : ""}</li>`).join("")}</ul>`,
    ),
    entry: medEntries.map((e) => ({ reference: e.fullUrl })),
  });
  compSections.push({
    title: "Problem List",
    code: { coding: [{ system: SYS.loinc, code: "11450-4" }] },
    text: narrative(
      condEntries.length === 0
        ? "<p>No active problems reported.</p>"
        : `<ul>${conds.map((c) => `<li>${escapeHtml(c.text)}</li>`).join("")}</ul>`,
    ),
    entry: condEntries.map((e) => ({ reference: e.fullUrl })),
  });
  if (!skip.has("procedures") && procedureEntries.length > 0) {
    compSections.push({
      title: "History of Procedures",
      code: { coding: [{ system: SYS.loinc, code: "47519-4" }] },
      text: narrative(
        `<ul>${(input.procedures ?? []).map((p) => `<li>${escapeHtml(p.text)}${p.performedDate ? ` (${p.performedDate})` : ""}</li>`).join("")}</ul>`,
      ),
      entry: procedureEntries.map((e) => ({ reference: e.fullUrl })),
    });
  }
  if (!skip.has("results") && observationEntries.length > 0) {
    compSections.push({
      title: "Results",
      code: { coding: [{ system: SYS.loinc, code: "30954-2" }] },
      text: narrative(
        `<ul>${(input.observations ?? []).map((o) => `<li>${escapeHtml(o.text)}${o.value !== undefined ? `: ${escapeHtml(String(o.value))}${o.unit ? " " + escapeHtml(o.unit) : ""}` : ""}</li>`).join("")}</ul>`,
      ),
      entry: observationEntries.map((e) => ({ reference: e.fullUrl })),
    });
  }
  if (!skip.has("immunizations") && !immunizationsThin && immunizationEntries.length > 0) {
    compSections.push({
      title: "Immunizations",
      code: { coding: [{ system: SYS.loinc, code: "11369-6" }] },
      text: narrative(
        `<ul>${(input.immunizations ?? []).map((i) => `<li>${escapeHtml(i.text)}${i.date ? ` (${i.date})` : ""}</li>`).join("")}</ul>`,
      ),
      entry: immunizationEntries.map((e) => ({ reference: e.fullUrl })),
    });
  }

  const compUrn = urn();
  const composition: Record<string, unknown> = {
    resourceType: "Composition",
    id: compUrn.replace("urn:uuid:", ""),
    status: "final",
    type: {
      coding: [{ system: SYS.loinc, code: "60591-5", display: "Patient Summary" }],
    },
    subject: { reference: patientRef, display: `${input.patient.givenName} ${input.patient.familyName}` },
    date: new Date().toISOString(),
    title: "Patient Summary",
    author:
      input.patientAuthored !== false
        ? [{ reference: patientRef, display: `${input.patient.givenName} ${input.patient.familyName} (patient-authored)` }]
        : [{ display: "Unknown" }],
    custodian: custodianRef ? { reference: custodianRef } : undefined,
    section: compSections,
  };

  // Composition is conventionally the first entry in an IPS document Bundle.
  entries.unshift({ fullUrl: compUrn, resource: composition });

  return {
    resourceType: "Bundle",
    id: randomUUID(),
    type: "document",
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
