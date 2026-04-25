declare module "pdf-parse/lib/pdf-parse.js" {
  // The inner module path exposes the same default function as `pdf-parse`,
  // but skips the package's debug-on-init clause.
  import type pdfParse from "pdf-parse";
  const fn: typeof pdfParse;
  export default fn;
}
