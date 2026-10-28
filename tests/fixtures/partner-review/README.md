# Synthetic returned review fixture

`libreoffice-annotated.docx` contains only invented review text, one comment by
“Reviewer”, and a tracked deletion/insertion in clause IMS-04. No real agreement,
owner, partner, reviewer or packet narrative appears in it.

SHA-256: `b0f013f6fb40c7b9b03f228bea13cdb3bad9238b216342b043731c5601764f0b`.

Generated `annotatedFeedbackParts()` from `tests/support/partner-feedback-fixture.mjs`,
ZIPped it, and opened/saved that DOCX with offline LibreOffice 7.4.7.2 using:

```sh
soffice -env:UserInstallation=file:///tmp/feedback-profile --headless \
  --convert-to docx --outdir /qa/feedback-returned /qa/feedback-input/annotated.docx
```

The isolated QA image was `3dprint4me-partner-docx-qa:20261024`, built on the project's
pinned Node 22 Bookworm base. No networking was enabled for document processing.
The returned file was rendered with the documents skill renderer and its page
visually inspected. The fixture tests extraction after a real office-suite save,
including comment ID renumbering, rather than only reading hand-constructed XML.
This proves LibreOffice compatibility for this fixture; Microsoft Word has not
been run in this environment and advanced revision formats still need manual review.
