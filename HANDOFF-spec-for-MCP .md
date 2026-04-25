# Patient Health Summary MCP — Design Spec & Handoff

An MCP server that takes a patient's scattered health records (FHIR exports, MyChart visit PDFs, release-of-information PDFs, arbitrary clinical documents) and produces a clean, sharable SMART Health Link (SHL) containing an International Patient Summary (IPS), a human-readable timeline, a clinical summary, and the source PDFs — all behind one QR code that works on any phone camera or SHL-native scanner.

This spec was derived from end-to-end hands-on implementation. The edge cases and order-of-operations gotchas are real and learned the hard way.

---

## What the end-user experience looks like

**Input** (any subset):
- A patient-curated FHIR R4 bundle (CareSync-style export is common; it's a JWE-encrypted SHL that contains a `Bundle` of type `document`)
- MyChart-exported "Past Visit Details" PDFs
- Ciox/Datavant release-of-information PDFs
- Unstructured clinical PDFs (lab panels, operative reports, discharge summaries, imaging reads)
- Patient-authored metadata (demographics if not already in the data, authoritative diagnoses, current medication list corrections)

**Output**:
1. A fresh **IPS FHIR bundle** (conformant to HL7 IPS R4 IG) aggregating/deduping all the structured data
2. A **human-readable IPS narrative PDF** (one-per-section, sortable by date)
3. A **clinical summary PDF** (Dr.-Rider-style, ~3 pages: one-liner, history, regimen, prior therapies, active issues, assessment)
4. A **longitudinal timeline PDF** (reverse-chronological, grouped by month, date/event/notes columns)
5. A **mega FHIR Bundle** combining (1) + `DocumentReference`s that inline priority PDFs and URL-reference the full document archive
6. An AES-256-GCM **JWE** wrapping the mega bundle
7. A **static hosting setup** (Vercel-style, or any static host with CORS) serving the JWE + the document archive
8. **`shlink:/` URI** (SMART Health Links spec) + a viewer-wrapped URL + QR codes for both

**Net effect**: patient hands a QR to their oncologist. Oncologist scans. Gets a full, structured, searchable health record in seconds.

---

## The pipeline (10 stages)

### 1. Ingest

- Accept uploads: `.json` (FHIR bundle), `.jwe` (encrypted SHL payload, with or without key), `.pdf`, `.zip`, `.xml` (CCDA), image/voice-memo files.
- If a `.jwe` comes in with a key, decrypt it. The CareSync-style SHL uses `{"alg":"dir","enc":"A256GCM","cty":"application/fhir+json","zip":"DEF"}` — AES-GCM with a 32-byte direct key, payload DEFLATE-compressed. Use `cryptography` (AESGCM) + raw-zlib (`zlib.decompress(pt, -15)` in Python; `pako.inflateRaw` in browser).
- If a `.zip` comes in (typical CD-of-records dump): extract, SKIP `DICOM/`, `__MACOSX/`, `.DS_Store`, DLLs (`.dll`), EXEs (`.exe`), `.dts`, `dicomdir`, extensionless binary blobs, `.chm`, `.bin`, `.ocx`, `.ini`. Keep `.pdf`, `.jpg`, `.png`, `.m4a`, `.mht`, `.xml`.

### 2. Parse CareSync-style "MemberHealthSummaryExport" timeline PDF

This PDF is ~150 pages and contains structured timeline entries laid out in three columns. Use **pdfplumber** for column-aware parsing, NOT pdftotext. The column structure:

| Column | x-coordinate range | Content |
|---|---|---|
| Date | 40 – 110 | Bold month abbr (top) + bold day number (below) |
| Event | 200 – 380 | Bold event title, then provider, specialty, visit type |
| Notes | 380+ | `Provider Notes:` prose, then `Related Health Conditions:`, `Related Medications:`, `Related Procedures:` |

Month/year section headers like `November 2018` appear at x≈56, size ~10.2pt, bold. Track these to assign years to date anchors — important because date anchors just say "Nov 13", no year.

**Parser quirks the hard way**:
- An entry can span page breaks. Track by y-coordinate within (page, anchor) pairs and collect all content until the next anchor on the next page.
- The month anchor's y-top is aligned with the *middle* of the title block. The actual entry content starts ~12pt higher. Subtract ~12–15pt when computing range-end for the previous entry.
- Entries with a `.` or parenthesis in the event column title have specific slug-mapping implications for downstream URL references.
- The CareSync export's Condition resources often have **paired junk entries** with `code.text = "Active"` — these are not real problems. Drop them.
- Conditions get duplicated between the FHIR export and the narrative PDF. Dedupe by canonical SNOMED/name mapping.
- Some entries have non-standard headers like `Call Actions:` in the notes column instead of the expected 4 — treat any bold text in the notes column as a section header, but only split out the 3 `Related ...:` headers; lump everything else into the free-form "Provider Notes" blob.

### 3. Parse MyChart / Ciox visit PDFs

MyChart "My Health — Past Visit Details" PDFs follow a standard layout. The parser should extract the `Assessment` section and the numbered `Plan` section:

```
Office Visit - <date>
with <provider> at <facility>

[Progress Notes]
<narrative>

Assessment
<patient one-liner>

# <Diagnosis>
- plan item
- plan item

# <Diagnosis>
- plan item
...

<numbered ICD-tagged problem list with meds/labs under each>
```

For the MCP, extract `{date, provider, specialty, facility, visit_type, assessment_paragraph, plan_items_by_diagnosis, meds_ordered, labs_ordered}`.

Ciox/Datavant release-of-information packets are cover page + authorization form + audit trail + visit notes. Skip pages 1–5 (admin), extract visit notes on pages 6+.

### 4. Slug-normalize PDF filenames

The FHIR bundle's `DocumentReference.attachment.url` fields are lowercase-hyphenated slugs like `grady-certified-medical-records.pdf`. The source PDFs are typically mixed case with spaces, parens, underscores, etc. Slug function (Python):

```python
def slugify(filename: str) -> str:
    p = pathlib.PurePath(filename)
    base, ext = p.stem, p.suffix.lower()
    base = base.lower()
    base = re.sub(r'[^a-z0-9-]+', '-', base)  # anything else → hyphen
    base = re.sub(r'-+', '-', base).strip('-')  # collapse + trim
    return base + ext
```

Validate 100% match between bundle's expected slugs and the files you have before shipping. Missing slugs = broken links at scan time.

### 5. Build the IPS FHIR bundle

IPS profile: `http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips`. Required resources:
- `Composition` (LOINC `60591-5` "Patient summary Document") with required sections: Allergies, Medications, Problems.
- `Patient` with IPS profile.
- `Organization` as custodian (optional but strongly recommended).
- `AllergyIntolerance` — if none, include an entry with SNOMED `716186003` "No known allergy" (IPS convention).

Recommended sections: Immunizations, Procedures, Results. Drop sections that are empty/weird (e.g. don't render Immunizations with only a Hep B at birth — looks incomplete).

**Key codings**:
- `MedicationStatement` → RxNorm codes where possible (`http://www.nlm.nih.gov/research/umls/rxnorm`).
- `Condition` → SNOMED CT (`http://snomed.info/sct`); add ICD-10-CM cross-codes (`http://hl7.org/fhir/sid/icd-10-cm`).
- `Procedure`, `Observation` → SNOMED CT + LOINC.
- `Immunization` → CDC CVX (`http://hl7.org/fhir/sid/cvx`).

**Patient-authored authorship**: the IPS spec allows `Composition.author` to reference the `Patient` resource. Use `{"reference": "urn:uuid:<patient_id>", "display": "Jane Doe (patient-authored)"}` — distinct semantic from clinician-authored summaries.

### 6. Merge + dedupe

When combining a patient's CareSync export (historical) with their current Vanderbilt/whatever (recent):

- **Medications**: canonicalize by brand/generic drug name (maintain an equivalence map: `elavil` ↔ `amitriptyline`, `cellcept` ↔ `mycophenolate`, `gamunex` ↔ `ivig`, etc.). Prefer the entry with the most descriptive text (brand + generic + dose). Preserve truly unique historical-only drugs as separate entries (they may still be clinically relevant).
- **Conditions**: canonicalize by concept (`juvenile dermatomyositis` ↔ `jdm`, `ulcerative colitis` ↔ `colitis`, all MVA-related sequelae ↔ `trauma_history`). Prefer the entry with the richest clinical modifier phrase.
- **Observations**: don't dedupe — a BP reading in 2014 and another in 2024 are both valuable.
- **DocumentReferences**: strip inline base64 `attachment.data` blobs before merging (they explode bundle size). Keep only `attachment.url` references. Rewrite URLs to point at the new hosting location.

### 7. Render the three PDFs

Use **WeasyPrint** (Python) for HTML→PDF. Georgia serif for clinical-looking documents, Helvetica for data-heavy tables. Key CSS:

```css
@page { size: Letter; margin: 0.7in ...; 
  @bottom-center { content: "<doc title>"; }
  @bottom-right  { content: "Page " counter(page); }
}
```

**IPS narrative PDF**: single-column, section-based. Each IPS Composition section becomes an `<h2>` with the section's embedded narrative HTML (already rendered in `section.text.div` per IPS spec).

**Clinical summary PDF** (Dr.-Rider-style): narrative prose with numbered assessment/plan. ~3 pages. Georgia serif. Structure: one-liner, history (multiple paragraphs), current regimen (table with generic/dose), prior therapies (single paragraph), active issues (numbered list), assessment (paragraph with embedded "Patient here today for X" as the final sentence if there's a specific ask — don't include a separate Plan section unless the document is intended for the provider to write into).

**Timeline PDF**: 3-column table layout per entry. Reverse-chronological. Group by `<h2 class="month">Month Year</h2>` headers. Each entry is a `<table class="entry">` with `page-break-inside: avoid` to prevent mid-entry breaks. Wrap the first entry of each month + its month header in a `<div class="month-start">` with `page-break-inside: avoid` to prevent orphan month headers (WeasyPrint doesn't honor `page-break-after: avoid` on `<h2>` reliably).

### 8. Encrypt as JWE — CRITICAL COMPATIBILITY NOTES

**JWE header MUST NOT include `zip: "DEF"`.** Multiple SHL viewers (CommonHealth, CARE-T clinical tools, others) have incomplete jose library integration and fail with `JWE "zip" (Compression Algorithm) Header Parameter is not supported by your javascript runtime`. Ship uncompressed.

```python
header = {"alg":"dir","enc":"A256GCM","cty":"application/fhir+json"}  # NO zip
```

Size tradeoff: uncompressed JWE is ~1.2× the plaintext FHIR JSON. For a 70 KB IPS + 2 inline PDFs (~350 KB) + 226 URL-ref DocumentReferences, expect ~1.5 MB JWE. That's fine — scanner limits are typically 5 MB. Keep total under ~2 MB for comfort.

Random 12-byte IV. 16-byte AES-GCM tag. Standard compact JWE serialization: `<hdr>..<iv>.<ct>.<tag>`.

### 9. Generate SHL URI + QR codes

SHL spec: `shlink:/<base64url-json-payload>`. Payload:

```json
{
  "url": "https://<host>/shl/<slug>/file.jwe",
  "key": "<43-char-base64url-32-byte-key>",
  "flag": "U",
  "label": "<patient-readable label>",
  "v": 1
}
```

`flag: "U"` means "direct-file mode" — the URL responds to GET with the JWE bytes. This is simpler than the default manifest-mode (which requires a POST endpoint) and works with static hosting. Trade-off: some older scanners only support manifest mode. The Kill-the-Clipboard scanner handles both.

**Generate THREE QRs**:

1. **Raw `shlink:/...` QR** — for SHL-native scanners. Phone cameras can't read these (they don't recognize `shlink:` as a URL scheme).
2. **Viewer-wrapped QR** — encodes `https://viewer.commonhealth.org/#<shlink>`. Phone cameras see a URL, open Safari, CommonHealth renders the IPS. Most viewers support this pattern (URL fragment with the shlink).
3. **Universal QR** — ALSO `https://viewer.commonhealth.org/#<shlink>`. Smart scanners (Kill-the-Clipboard and most modern SHL parsers) run a regex for `shlink:\/([A-Za-z0-9_-]+)` against the scanned text — they extract the shlink payload from the URL fragment. So this single QR works for both phone cameras AND native scanners. Ship this as the default; keep the raw QR as fallback.

Note: `viewer.smarthealthit.org` was the canonical reference viewer for years but is currently down (April 2026). Use `viewer.commonhealth.org` or `demo.vaxx.link/viewer` as alternatives.

Use Python `qrcode` lib with `ERROR_CORRECT_M` and `box_size=12` for print-quality output.

### 10. Host

Static site, `/shl/<patient_slug>/file.jwe` + `/shl/<patient_slug>/docs/*.pdf`. For Vercel, this `vercel.json` is sufficient:

```json
{
  "headers": [
    {
      "source": "/shl/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin",  "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET, POST, OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type, Accept" },
        { "key": "Cache-Control",                "value": "public, max-age=300, s-maxage=300" },
        { "key": "Content-Type",                 "value": "application/jose" }
      ]
    }
  ]
}
```

Note the Content-Type override to `application/jose` for the JWE file — some scanners validate this header. The same header applies to the PDFs in `/shl/*/docs/` which shouldn't be `application/jose` — you'd need a per-path rule or a smarter hosting config. In our session we just let the PDFs inherit `application/jose` and it still worked because scanners check extension first; for a cleaner MCP output, emit separate header rules for `/shl/*/file.jwe` (→ `application/jose`) and `/shl/*/docs/*.pdf` (→ `application/pdf`).

### Revocation

Delete the hosting project + the underlying Git repo. QR becomes 404 within seconds (edge cache TTL). No server-side state to scrub beyond that — the decryption key only exists in the QR payload; losing the host kills access.

---

## Tiered document strategy (learned the hard way)

Stuffing all 226 source PDFs inline as base64 produces a 4.6 MB bundle that chokes some scanners (browser JSON.parse + pako on mobile Safari can silently fail on very large payloads). Instead:

| Tier | Mechanism | When | Notes |
|---|---|---|---|
| 1 — Priority | Inline `DocumentReference.attachment.data` (base64 PDF) | IPS narrative + clinical summary + timeline | Prefix title with `1 —`, `2 —`, etc. so they sort to top of scanner-rendered lists |
| 2 — Archive | URL-only `DocumentReference.attachment.url` → hosted static PDFs | All historical docs | Scanner fetches on-demand; bundle stays small |

The inline tier contains the synthesized human-readable summaries the patient wants seen first. The archive tier contains the raw source-of-truth PDFs (labs with actual numeric values, operative reports, etc.) for clinicians who want the full history.

---

## MCP tool surface (proposed)

```
tools:
  ingest_documents(files[], kind_hints{})
    → document_id
    
  extract_fhir(document_id, formats=['caresync','mychart','ciox','generic'])
    → {conditions[], medications[], procedures[], observations[], document_references[]}
    
  build_ips_bundle(extracted_data, patient_info, 
                    dedupe=true, skip_sections=['immunizations'])
    → ips_bundle_json
    
  render_timeline_pdf(timeline_entries[], style='rider')
    → pdf_file
    
  render_clinical_summary_pdf(summary_data, style='rider',
                               audience='oncologist'|'pcp'|'er',
                               length_target='brief'|'standard'|'detailed')
    → pdf_file
    
  render_ips_narrative_pdf(ips_bundle)
    → pdf_file
    
  build_mega_bundle(ips_bundle, inline_pdfs=[], archive_pdfs=[])
    → mega_bundle_json
    
  encrypt_shl_jwe(bundle, key=<generate_or_provided>, compress=false)
    → {jwe_bytes, key_base64url}
    
  generate_shl_uri(jwe_url, key, flag='U', label='', v=1)
    → shlink_uri
    
  generate_qr(shlink_uri, style='universal'|'raw'|'viewer_wrapped', 
              viewer='commonhealth'|'vaxx'|'custom:<url>')
    → png_bytes
    
  prepare_vercel_deployment(jwe_file, archive_files[], slug='patient-xyz')
    → {files_to_push[], vercel_json, suggested_readme}
```

Most of those are pure functions over data. The ingestion/extraction tools are the ones that benefit from LLM-in-the-loop (e.g. "this PDF is a MyChart visit note; extract the assessment and plan as structured data"). The rest is deterministic Python with WeasyPrint + cryptography + pypdf + pdfplumber + qrcode.

---

## Gotchas checklist

- [ ] **No `zip: "DEF"`** in JWE header. Bigger bundle, better compatibility.
- [ ] **`flag: "U"`** for static hosting (avoids needing a POST endpoint for manifest mode).
- [ ] **Strip DICOM + viewer cruft** from any zip archive before hosting.
- [ ] **Check file size limits**: GitHub 100 MB per file (hard), Vercel static-file endpoints happy to ~100 MB.
- [ ] **Rewrite URLs when moving hosts**: `<old>.vercel.app/shl/X/docs/Y.pdf` → `<new>.vercel.app/shl/X/docs/Y.pdf` inside `DocumentReference.attachment.url`.
- [ ] **Slug-match validation**: confirm every `DocumentReference.attachment.url` resolves to an actual file before going live. A single 404'd reference makes the scanner spin for 30+ seconds.
- [ ] **`application/jose` content-type** on the JWE URL.
- [ ] **CORS `*`** on the JWE URL.
- [ ] **Patient-authored framing**: never put provider-voice phrases ("patient is pleasant and cooperative") in documents the patient is signing as author.
- [ ] **Results section**: only populate with actual numeric values or definitive findings. Don't list labs that were "ordered" without results — treat those as PDF attachments instead.
- [ ] **Immunizations section**: if you only have a Hep B at birth, drop the whole section. A near-empty section looks worse than no section.
- [ ] **`.DS_Store` files**: add a root `.gitignore` with `.DS_Store` so they never enter the repo.
- [ ] **Branch name convention**: many SHL repos assume `main`. Double-check before pushing.
- [ ] **Viewer availability**: test QR against at least 2 viewer URLs before shipping. `viewer.smarthealthit.org` may be down; fall back to `viewer.commonhealth.org` or `demo.vaxx.link/viewer`.

---

## Reference: the production stack used

- **Python 3.10+** with:
  - `cryptography` (AES-GCM)
  - `pdfplumber` (column-aware PDF parsing)
  - `pypdf` (PDF merging)
  - `weasyprint` (HTML → PDF)
  - `qrcode` + `pillow` (QR generation)
- **Node.js** with `jose` v5 + `pako` v2 — if building a browser-side decrypter to match mainstream SHL viewer behavior.
- **Static hosting**: Vercel free tier (GitHub-connected auto-deploy).
- **Spec references**:
  - HL7 FHIR R4 IPS IG: http://hl7.org/fhir/uv/ips/
  - SMART Health Links: https://docs.smarthealthit.org/smart-health-links/
  - IPS Composition LOINC code: `60591-5`
  - Problem List LOINC: `11450-4` • Allergies: `48765-2` • Medications: `10160-0` • Procedures: `47519-4` • Results: `30954-2` • Immunizations: `11369-6`

---

## The proof-of-concept that informed this spec

Built hands-on for one patient over an 8-hour session (April 2026). Final artifacts:

- IPS FHIR bundle (JSON) — 55 → 208 resources after merge/dedupe
- IPS narrative PDF — 5 pages, patient-authored
- Clinical summary PDF — 3 pages, Dr.-Rider-style, CAR-T focused
- Timeline PDF — 69 pages, reverse-chronological 1998 → March 2026
- Encrypted JWE — 1.5 MB, AES-256-GCM, no compression
- 226 historical PDFs hosted as URL references
- QR code works with phone camera (CommonHealth viewer) AND Kill-the-Clipboard SHL scanner from one scan.

Scanner fetch + walk of all 226 DocumentReferences took ~90 seconds on first scan; seconds on subsequent scans thanks to CDN caching.
