// Measurement steps start with one line and "+ Add line" adds more (Oct 2026). Tests written for
// the old four starting rows fill [data-row="N"] directly — this adds lines as needed first.
module.exports = function(page){
  const ensure = async sel => {
    const m = /\[data-row="(\d+)"\]/.exec(sel || ''); if (!m) return;
    const n = +m[1];
    for (let i = 0; i < 12; i++) {
      if (await page.$(`div[data-row="${n}"]`)) break;
      const b = await page.$('button[data-action="addMeasRow"]'); if (!b) break;
      await b.click(); await page.waitForTimeout(150);
    }
  };
  for (const fn of ['fill','click','$eval','selectOption','type','check','uncheck']) {
    const orig = page[fn].bind(page);
    page[fn] = async (sel, ...rest) => { await ensure(sel); return orig(sel, ...rest); };
  }
  return page;
};
