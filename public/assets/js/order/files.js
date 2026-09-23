const ALLOWED_EXTENSIONS = [".stl", ".3mf", ".step", ".stp", ".obj", ".f3d", ".zip", ".jpg", ".jpeg", ".png", ".webp", ".pdf", ".txt"];

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function createFileManager({ config, client, notify, render, onChange = () => {} }) {
  const selected = [];
  function changed() { render(selected); onChange(selected); }
  return {
    list: () => [...selected],
    add(collection) {
      for (const file of [...collection]) {
        const extension = `.${file.name.split(".").pop().toLowerCase()}`;
        if (!ALLOWED_EXTENSIONS.includes(extension)) { notify(`${file.name}: unsupported file type.`); continue; }
        if (file.size > config.maxUploadBytes) { notify(`${file.name}: larger than ${formatBytes(config.maxUploadBytes)}.`); continue; }
        if (selected.some(existing => existing.name === file.name && existing.size === file.size)) continue;
        if (selected.length >= config.maxFiles) { notify(`Up to ${config.maxFiles} files can be attached.`); break; }
        selected.push(file);
      }
      changed();
    },
    remove(index) { selected.splice(index, 1); changed(); },
    prepare(requestId, mode, onProgress) { return client.prepareFiles(requestId, mode, selected, onProgress); }
  };
}
