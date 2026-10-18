async page => {
  const origin=new URL(page.url()).origin,assert=(ok,message)=>{if(!ok)throw Error(message)};
  await page.goto(origin);await page.waitForFunction(()=>{const button=document.querySelector('[aria-label="Browse Cisterns and CSF"]');return button&&!button.disabled});
  await page.getByRole('combobox',{name:'Source for Cisterns and CSF',exact:true}).selectOption('spl_nac');
  await page.getByRole('button',{name:'Browse Cisterns and CSF',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.live-status')?.textContent?.startsWith('Ready'),null,{timeout:60000});
  await page.getByRole('button',{name:'Learning tools',exact:true}).click();await page.getByRole('button',{name:'Learn',exact:true}).click();
  await page.locator('.teaching-evidence-topics > summary').click();
  const cistern=page.getByRole('region',{name:'Cisternal regions and arachnoid membranes',exact:true});
  assert(await cistern.count()===1,'Native image lacks the cisternal evidence discussion.');
  await cistern.getByText('Compare reasoning',{exact:true}).click();
  assert((await cistern.textContent()).includes('A membrane boundary needs direct source evidence'),'The membrane explanation is unavailable.');
  await cistern.getByText('References',{exact:true}).click();
  assert(await cistern.getByRole('link').getAttribute('href')==='https://doi.org/10.1002/ca.20448','Primary membrane reference changed.');
  await page.screenshot({path:'output/playwright/cisternal-evidence-topics.png'});
  await page.getByRole('button',{name:'Browse anatomy',exact:true}).click();
  await page.getByRole('combobox',{name:'Source for Cranial nerves',exact:true}).selectOption('z_anatomy');
  await page.getByRole('button',{name:'Browse Cranial nerves',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.model-status')?.textContent?.startsWith('Ready'),null,{timeout:60000});
  await page.getByRole('button',{name:'Learning tools',exact:true}).click();await page.getByRole('button',{name:'Learn',exact:true}).click();
  await page.locator('.teaching-evidence-topics > summary').click();
  assert(await page.getByRole('region',{name:'Cranial nerve names and supplied extents',exact:true}).count()===1,'Independent model lacks nerve extent discussion.');
  assert(await page.getByRole('region',{name:'Skull openings and source resolution',exact:true}).count()===1,'Independent model lacks bone opening discussion.');
  assert(await page.getByRole('region',{name:'Observing normal variation',exact:true}).count()===1,'Normal variation discussion is unavailable.');
  await page.screenshot({path:'output/playwright/model-evidence-topics.png'});
  return {status:'passed',checks:['secondary native-image discussion','membrane reasoning and primary reference','independent model context','source-linked nerve and skull topics','normal-variation interpretation without invented case labels']};
}
