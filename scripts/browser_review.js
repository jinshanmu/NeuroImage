async page => {
  // Open a locally prepared review packet's index.html before running this check.
  const failures=[];page.on('pageerror',error=>failures.push(String(error)));
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const plan=await page.locator('#plan').textContent().then(JSON.parse);
  const template=await page.locator('#assessment').textContent().then(JSON.parse);
  await page.waitForFunction(()=>Array.from(document.images).every(image=>image.complete&&image.naturalWidth>0));
  assert(await page.locator('article img').count()===plan.cases.length,'Some source scenes were not captured.');
  const values=await page.locator('article select').evaluateAll(inputs=>inputs.map(input=>input.value));
  assert(values.length===template.items.reduce((count,item)=>count+Object.keys(item.criteria).length,0),'Review criteria are missing.');
  assert(values.every(value=>value==='not_assessed'),'The initial packet contains a reviewer judgment.');
  assert(await page.getByRole('textbox',{name:'Reviewer name',exact:true}).inputValue()==='','A reviewer was prefilled.');
  const path='data/benchmarks/review-browser/'+plan.package_id+'-'+plan.packet_version+'.json';
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export assessment JSON',exact:true}).click();
  await (await download).saveAs(path);
  const wrong={...template,space_id:'deliberately-incompatible-test-space'};
  await page.locator('input[type=file]').setInputFiles({name:'wrong-space.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(wrong))});
  await page.getByRole('alert').filter({hasText:/different review packet/}).waitFor();
  await page.locator('input[type=file]').setInputFiles(path);
  await page.waitForFunction(()=>document.querySelector('#error').textContent==='');
  assert((await page.locator('#progress').textContent()).startsWith('0 /'),'Importing the blank record created judgments.');
  await page.screenshot({path:'output/playwright/review-form-validated.png'});
  await page.locator('article').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:'output/playwright/review-case-validated.png'});
  assert(!failures.length,failures.join('\n'));
  return {status:'passed',captured_structures:plan.cases.length,criteria:values.length,
    checks:['all local images loaded','all judgments start unassessed','blank assessment export and import','different native-space assessment rejected'],
    page_errors:failures,anatomical_review:'not_performed'};
}
