import assert from 'node:assert/strict'
export async function openLocalCockpit(page){
  const entry=page.getByRole('button',{name:'Abrir estudio detallado',exact:true})
  if(await entry.isVisible())await entry.click()
  await page.getByRole('button',{name:'ANALIZAR SOL Y TIERRA',exact:true}).waitFor()
}
export async function openReferencePlanner(page){
  const direct=page.getByRole('button',{name:'Herramientas científicas',exact:true})
  if(await direct.isVisible())await direct.click()
  else await page.getByRole('button',{name:'Comparar referencias',exact:true}).click()
  await page.getByRole('button',{name:'Volver al cockpit'}).waitFor()
  assert.ok(await page.getByRole('button',{name:'Volver al cockpit'}).isVisible())
}
