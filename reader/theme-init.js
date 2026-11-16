// The chosen colours, set before the first paint so the page never flashes.
try {
  var stored = localStorage.getItem("faithformbench-reader-theme");
  if (stored === "light" || stored === "dark") document.documentElement.setAttribute("data-theme", stored);
} catch (error) {}
