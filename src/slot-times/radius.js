((root) => {
  const miles = (lat1, lon1, lat2, lon2) => {
    const earth = 3958.8, rad = Math.PI / 180;
    const p1 = lat1 * rad, p2 = lat2 * rad;
    const dp = (lat2 - lat1) * rad, dl = (lon2 - lon1) * rad;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };
  root.SLOT_RADIUS = Object.freeze({ miles });
})(typeof window === "undefined" ? globalThis : window);
