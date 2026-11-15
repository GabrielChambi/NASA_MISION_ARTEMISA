import assert from 'node:assert/strict'
export async function openReferencePlanner(page){
  await page.getByRole('button',{name:'Comparar referencias',exact:true}).click()
  await page.getByRole('button',{name:'Volver al cockpit'}).waitFor()
  assert.ok(await page.getByRole('button',{name:'Volver al cockpit'}).isVisible())
}
