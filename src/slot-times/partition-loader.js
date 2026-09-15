(() => {
  const data = window.SLOT_DATA;
  const availableDates = new Set(data.partitionDates || []);
  const cached = new Map();

  function datesInRange(from, through) {
    const cursor = new Date(`${from}T12:00:00`);
    const end = new Date(`${through}T12:00:00`);
    const dates = [];
    while (cursor <= end) {
      const date = [cursor.getFullYear(), String(cursor.getMonth() + 1).padStart(2, "0"), String(cursor.getDate()).padStart(2, "0")].join("-");
      if (availableDates.has(date)) dates.push(date);
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  async function readDate(date) {
    if (!cached.has(date)) {
      cached.set(date, fetch(`data/cardiology/slots/${date}.json`).then(async (response) => {
        if (!response.ok) throw new Error(`Could not load appointment data for ${date} (${response.status}).`);
        const payload = await response.json();
        return payload.slots || [];
      }));
    }
    return cached.get(date);
  }

  window.SLOT_PARTITIONS = {
    async load(from, through) {
      const groups = await Promise.all(datesInRange(from, through).map(readDate));
      data.slots = groups.flat();
      return data.slots;
    },
  };
})();
