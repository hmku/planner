(function (Planner) {
  function cloneTemplate(templateId) {
    const template = document.getElementById(templateId);
    if (!template) {
      throw new Error(`Missing template: ${templateId}`);
    }
    return template.content.firstElementChild.cloneNode(true);
  }


  // Builds each [data-section-header] section's header from #sectionHeaderTemplate:
  // title, optional summary, then toolbar = custom slot content, picker, download.
  function mountSectionHeaders() {
    document.querySelectorAll("[data-section-header]").forEach((section) => {
      const { title, summaryId, summaryText, pickerId, pickerLabel, downloadId, downloadLabel } = section.dataset;
      const header = cloneTemplate("sectionHeaderTemplate");
      header.querySelector("h2").textContent = title;

      const summary = header.querySelector("p");
      if (summaryId) summary.id = summaryId;
      if (summaryText) summary.textContent = summaryText;
      else if (!summaryId) summary.remove();

      const toolbar = header.querySelector(".section-toolbar");
      const toolbarSlot = section.querySelector("[data-section-toolbar]");
      if (toolbarSlot) {
        toolbar.append(...toolbarSlot.childNodes);
        toolbarSlot.remove();
      }
      if (pickerId) {
        const picker = cloneTemplate("pickerControlTemplate");
        picker.querySelector("span").textContent = pickerLabel || "";
        picker.querySelector("select").id = pickerId;
        toolbar.appendChild(picker);
      }
      if (downloadId) {
        const button = cloneTemplate("downloadButtonTemplate");
        const label = downloadLabel || "Download CSV";
        button.id = downloadId;
        button.setAttribute("aria-label", label);
        button.title = label;
        toolbar.appendChild(button);
      }
      if (!toolbar.childElementCount) toolbar.remove();

      section.insertBefore(header, section.firstChild);
    });
  }

  Object.assign(Planner, {
    mountSectionHeaders
  });
})(window.Planner = window.Planner || {});
