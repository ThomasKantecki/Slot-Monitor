((root) => {
  const today = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  root.SUITE_DATE = Object.freeze({ today });
})(typeof window === "undefined" ? globalThis : window);
