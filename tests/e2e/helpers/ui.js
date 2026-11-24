export async function openDetails(locator) {
  await locator.evaluate((node) => {
    node.open = true;
  });
}

export async function readSurfaceLuminance(page, selectors) {
  return page.evaluate((surfaceSelectors) => {
    function luminanceFromColor(color) {
      const match = color.match(/rgba?\(([^)]+)\)/);
      if (!match) {
        return 255;
      }
      const [r, g, b] = match[1]
        .split(",")
        .slice(0, 3)
        .map((value) => Number(value.trim()));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    return surfaceSelectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        return { selector, exists: false, luminance: 255 };
      }
      const color = window.getComputedStyle(element).backgroundColor;
      return { selector, exists: true, luminance: luminanceFromColor(color) };
    });
  }, selectors);
}
