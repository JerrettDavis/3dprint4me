export function createStepValidator({ document, form, getData, getFiles, fieldError, clearErrors, notify }) {
  return function validateStep(index) {
    clearErrors();
    const data = getData();
    const invalid = [];
    const require = (id, message) => {
      const field = document.querySelector(`#${id}`);
      if (!field || field.disabled || String(field.value || "").trim()) return;
      fieldError(field, message);
      invalid.push(field);
    };

    if (index === 0 && !data.service) {
      const field = document.querySelector("input[name='service']");
      fieldError(field, "Choose a service to continue.", "#service-error");
      invalid.push(field);
    }
    if (index === 1) {
      require("project-title", "Give the project a short name.");
      require("description", "Describe what you need and how it will be used.");
      if (data.service === "print" && getFiles().length === 0 && !String(data.modelUrl || "").trim()) {
        const field = document.querySelector("#model-url");
        fieldError(field, "Add a model file or a link so the part can be reviewed.");
        invalid.push(field);
      }
      if (data.service === "repair") require("printer-model", "Add the printer make and model.");
      const modelUrl = document.querySelector("#model-url");
      if (modelUrl.value && !modelUrl.checkValidity()) {
        fieldError(modelUrl, "Enter a complete web address, including https://.");
        invalid.push(modelUrl);
      }
    }
    if (index === 2) {
      require("name", "Add your name.");
      require("email", "Add an email address.");
      const email = document.querySelector("#email");
      if (email.value && !email.checkValidity()) {
        fieldError(email, "Enter a valid email address.");
        invalid.push(email);
      }
      if (data.delivery === "shipping") require("address", "Add the shipping destination.");
      if (["text", "call"].includes(data.preferredContact) && !String(data.phone || "").trim()) {
        const phone = document.querySelector("#phone");
        fieldError(phone, `Add a phone number for ${data.preferredContact === "text" ? "text replies" : "phone calls"}.`);
        invalid.push(phone);
      }
    }
    if (index === 3 && !document.querySelector("#terms").checked) {
      const field = document.querySelector("#terms");
      fieldError(field, "Please confirm the estimate and project terms.");
      invalid.push(field);
    }
    if (invalid.length) {
      invalid[0].focus();
      notify("Please check the highlighted field.");
      return false;
    }
    return true;
  };
}
