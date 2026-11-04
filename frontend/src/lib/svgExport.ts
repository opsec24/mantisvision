/**
 * Utility to export an SVG DOM element losslessly as a standalone .svg file.
 */
export function exportSvgToFile(
  svgElement: SVGSVGElement | null,
  filename: string,
  options?: {
    backgroundColor?: string;
    padding?: number;
  }
) {
  if (!svgElement) return;

  try {
    const clone = svgElement.cloneNode(true) as SVGSVGElement;

    // Ensure standard XML and xlink namespaces
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

    // Add font definitions directly so external viewers (Illustrator, Inkscape, Chrome) render correctly
    const styleEl = document.createElement("style");
    styleEl.textContent = `
      text {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
    `;
    clone.insertBefore(styleEl, clone.firstChild);

    // If background color is specified, inject a backdrop rect at the very back
    if (options?.backgroundColor) {
      const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const bbox = clone.viewBox.baseVal;
      bgRect.setAttribute("x", bbox.x.toString());
      bgRect.setAttribute("y", bbox.y.toString());
      bgRect.setAttribute("width", bbox.width.toString());
      bgRect.setAttribute("height", bbox.height.toString());
      bgRect.setAttribute("fill", options.backgroundColor);
      clone.insertBefore(bgRect, clone.children[1] || null);
    }

    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(clone);

    // Add XML header
    if (!svgString.startsWith("<?xml")) {
      svgString = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + svgString;
    }

    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".svg") ? filename : `${filename}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Failed to export SVG:", err);
  }
}
