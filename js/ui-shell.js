(function (Planner) {
  function cloneTemplate(templateId) {
    const template = document.getElementById(templateId);
    if (!template) {
      throw new Error(`Missing template: ${templateId}`);
    }
    return template.content.firstElementChild.cloneNode(true);
  }



  function buildSectionHeader({ title, summaryId = null, summaryText = "" }) {
    const header = cloneTemplate("sectionHeaderTemplate");
    header.querySelector("h2").textContent = title;
    const summary = header.querySelector("p");
    if (summaryId) {
      summary.id = summaryId;
    }
    if (summaryText) {
      summary.textContent = summaryText;
    } else {
      summary.remove();
    }
    return header;
  }



  function buildPickerControl(labelText, selectId) {
    const picker = cloneTemplate("pickerControlTemplate");
    picker.querySelector("span").textContent = labelText;
    picker.querySelector("select").id = selectId;
    return picker;
  }



  function buildDownloadButton(buttonId, label) {
    const button = cloneTemplate("downloadButtonTemplate");
    button.id = buttonId;
    button.setAttribute("aria-label", label);
    button.title = label;
    return button;
  }



  function mountSectionHeaders() {
    document.querySelectorAll("[data-section-header]").forEach((section) => {
      const header = buildSectionHeader({
        title: section.dataset.title,
        summaryId: section.dataset.summaryId || null,
        summaryText: section.dataset.summaryText || ""
      });
      const toolbar = header.querySelector(".section-toolbar");
      const toolbarSlot = section.querySelector("[data-section-toolbar]");
      if (toolbarSlot) {
        while (toolbarSlot.firstChild) {
          toolbar.appendChild(toolbarSlot.firstChild);
        }
        toolbarSlot.remove();
      }
      if (section.dataset.pickerId) {
        toolbar.appendChild(buildPickerControl(section.dataset.pickerLabel || "", section.dataset.pickerId));
      }
      if (section.dataset.downloadId) {
        toolbar.appendChild(buildDownloadButton(section.dataset.downloadId, section.dataset.downloadLabel || "Download CSV"));
      }
      if (!toolbar.childElementCount) {
        toolbar.remove();
      }
      section.insertBefore(header, section.firstChild);
    });
  }


  Object.assign(Planner, {
    cloneTemplate,
    buildSectionHeader,
    buildPickerControl,
    buildDownloadButton,
    mountSectionHeaders
  });
})(window.Planner = window.Planner || {});
