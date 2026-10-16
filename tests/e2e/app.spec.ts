import {test,expect} from '@playwright/test';
for(const width of [320,390,768,1440]){
  test(`new homepage has one image, compact prayers and no overflow at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});await page.goto('/');
    await expect(page.getByRole('heading',{level:1})).toContainText('en oración');
    await expect(page.locator('main img:visible')).toHaveCount(1);await expect(page.locator('.prayer-links li')).toHaveCount(7);
    await expect(page.locator('.gallery-section')).toHaveCount(0);
    await page.locator('#main-menu summary').click();const nav=page.getByRole('navigation',{name:'Menú principal'});await expect(nav.getByRole('link')).toHaveCount(9);
    await nav.getByRole('link',{name:'Intenciones',exact:false}).click();await expect(page).toHaveURL(/#intenciones$/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('tab',{name:'Intercesor',exact:true}).click();await page.getByRole('button',{name:'Explorar la bandeja'}).click();
    await expect(page.getByRole('tablist')).toBeHidden();await expect(page.locator('#panel-intention')).toBeHidden();
    await expect(page.locator('.prayer-library')).toBeHidden();await expect(page.locator('.marian-hero')).toBeHidden();
    await expect(page.locator('.intercessor-marian img')).toBeVisible();await expect(page.locator('main img:visible')).toHaveCount(1);
    await expect(page.getByRole('heading',{level:1})).toContainText('Acompañamos');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
test('public form keeps petition/gratitude, removes email and validates consent without sending demo data',async({page})=>{
  let external=0;page.on('request',r=>{if(/supabase|resend/.test(r.url()))external++;});await page.goto('/');
  const form=page.locator('.public-form');await expect(form.locator('input[type=email]')).toHaveCount(0);
  await form.getByLabel('Nombre o alias').fill('Alias de prueba');await form.getByLabel('Un agradecimiento',{exact:true}).check();
  await form.getByLabel('Tu intención',{exact:false}).fill('Un agradecimiento ficticio para comprobar este formulario.');
  await form.getByRole('button',{name:'Enviar mi intención'}).click();await expect(form.getByRole('status')).toHaveText('');
  await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Enviar mi intención'}).click();await expect(form.getByRole('status')).toContainText('No se guardaron datos');expect(external).toBe(0);
});
test('signed-in view stays in the inbox and restores the public page on logout',async({page})=>{
  await page.goto('/#intercesor');await page.getByRole('button',{name:'Explorar la bandeja'}).click();
  await expect(page.locator('#inbox-title')).toBeFocused();
  await page.evaluate(()=>{document.querySelector<HTMLButtonElement>('#tab-intention')!.click();location.hash='intenciones';});
  await expect(page.locator('#panel-intention')).toBeHidden();await expect(page.locator('#intercessor-dashboard')).toBeVisible();
  await page.locator('#main-menu summary').click();const nav=page.getByRole('navigation',{name:'Menú principal'});
  await expect(nav.getByRole('link',{name:/Ave María|Salve|Rosario|Intenciones/})).toHaveCount(0);
  await expect(nav.getByRole('link',{name:'Mi bandeja'})).toBeVisible();await nav.getByRole('link',{name:'Mi bandeja'}).click();
  await page.getByRole('button',{name:'Cerrar sesión'}).click();
  await expect(page.getByRole('tab',{name:'Intención',exact:true})).toBeVisible();
  await expect(page.locator('.prayer-library')).toBeVisible();await expect(page.locator('.marian-hero')).toBeVisible();
  await expect(page.locator('.intercessor-marian')).toBeHidden();
  await page.getByRole('tab',{name:'Intención',exact:true}).click();await expect(page.locator('.public-form')).toBeVisible();
});
test('tabs support keyboard and direct Intercesor links',async({page})=>{
  await page.goto('/');const first=page.getByRole('tab',{name:'Intención',exact:true}),second=page.getByRole('tab',{name:'Intercesor',exact:true});
  await first.focus();await page.keyboard.press('ArrowRight');await expect(second).toBeFocused();await expect(second).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('Home');await expect(first).toBeFocused();await page.goto('/#intercesor');await expect(second).toHaveAttribute('aria-selected','true');
});
test('footer Intercesor opens and focuses access even when the URL hash is unchanged',async({page})=>{
  await page.goto('/');const footer=page.locator('footer');
  await expect(footer).not.toContainText('Textos pendientes de revisión pastoral');
  await footer.getByRole('link',{name:'Intercesor',exact:true}).click();
  await expect(page).toHaveURL(/#intercesor$/);await expect(page.locator('#intercessor-username')).toBeFocused();
  await expect(page.getByRole('tab',{name:'Intercesor',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'Intención',exact:true}).click();
  await footer.getByRole('link',{name:'Intercesor',exact:true}).click();
  await expect(page.locator('#intercessor-username')).toBeFocused();await expect(page.locator('#panel-intention')).toBeHidden();
  await page.getByRole('button',{name:'Explorar la bandeja'}).click();
  await footer.getByRole('link',{name:'Intercesor',exact:true}).click();
  await expect(page.locator('#inbox-title')).toBeFocused();await expect(page.locator('#intercessor-dashboard')).toBeVisible();
  await page.goto('/templos/');await page.locator('footer').getByRole('link',{name:'Intercesor',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Intercesor',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#intercessor-login')).toBeVisible();
});
test('opening marks a message read, keeps it available and never counts a reread twice',async({page})=>{
  await page.goto('/#intercesor');await page.getByRole('button',{name:'Explorar la bandeja'}).click();
  const items=page.locator('#inbox-list .inbox-item');await expect(items).toHaveCount(2);await expect(page.locator('#stat-total-messages')).toHaveText('3');await expect(page.locator('#stat-petitions-read')).toHaveText('1 leídas');
  await items.first().click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog).toContainText('Por la salud de mi familia');await expect(page.locator('#stat-total-messages')).toHaveText('3');await expect(page.locator('#stat-petitions-read')).toHaveText('2 leídas');
  await page.getByRole('button',{name:'Cerrar mensaje',exact:true}).click();await expect(items).toHaveCount(1);
  await page.getByRole('button',{name:'Leídos',exact:true}).click();await expect(items).toHaveCount(2);await expect(items.first()).toContainText('Leído');
  await items.first().click();await expect(dialog).toBeVisible();await expect(page.locator('#stat-petitions-read')).toHaveText('2 leídas');await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Todos',exact:true}).click();await expect(items).toHaveCount(3);
  await expect(page.getByRole('button',{name:/archivar|borrar|mover|marcar como rezada/i})).toHaveCount(0);
  await page.getByRole('button',{name:'Cerrar sesión'}).click();await expect(page.locator('#intercessor-dashboard')).toBeHidden();await expect(page.locator('#inbox-list')).toBeEmpty();
});
test('registration is unlinked, requires invitation and rejects spaces in usernames',async({page})=>{
  await page.goto('/');await expect(page.locator('a[href*="intercesor/alta"]')).toHaveCount(0);
  await page.goto('/intercesor/alta/');await expect(page.locator('#enrollment-form')).toBeHidden();await expect(page.locator('#enrollment-link-status')).toContainText('Necesitás el enlace');
  await page.goto('/intercesor/alta/#clave=example-invitation');await expect(page.locator('#enrollment-form')).toBeVisible();await expect(page).not.toHaveURL(/clave/);
  const user=page.getByLabel(/^Usuario/);await user.fill('con espacio');expect(await user.evaluate((el:HTMLInputElement)=>el.checkValidity())).toBe(false);
  await user.fill('ana_maria');expect(await user.evaluate((el:HTMLInputElement)=>el.checkValidity())).toBe(true);
  await page.getByLabel(/^Contraseña/).fill('una-clave-de-prueba');await page.getByLabel('Repetí la contraseña').fill('una-clave-de-prueba');
  await page.getByRole('button',{name:'Crear mi cuenta'}).click();await expect(page.locator('#enrollment-status')).toContainText('No se creó una cuenta');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content','noindex, nofollow');
});
test('recovery explains the saved code and checks password confirmation',async({page})=>{
  await page.goto('/intercesor/recuperar/');await page.getByLabel(/^Usuario/).fill('ana');await page.getByLabel('Código de recuperación').fill('abcd'.repeat(12));await page.getByLabel(/^Nueva contraseña/).fill('una-clave-de-prueba');await page.getByLabel('Repetí la nueva contraseña').fill('otra-clave-de-prueba');await page.getByRole('button',{name:'Cambiar contraseña'}).click();await expect(page.locator('#enrollment-status')).toContainText('no coinciden');
});
test('prayers still work offline; messages, enrollment and recovery are never cached',async({page,context})=>{
  await page.goto('/');await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.goto('/oraciones/ave-maria/');await expect(page.locator('.prayer-text')).toContainText('Dios te salve');const before=await page.locator('.prayer-text').evaluate(el=>getComputedStyle(el).fontSize);await page.getByRole('button',{name:'Aumentar tamaño'}).click();expect(parseFloat(await page.locator('.prayer-text').evaluate(el=>getComputedStyle(el).fontSize))).toBeGreaterThan(parseFloat(before));
  await context.setOffline(true);await page.reload();await expect(page.locator('.prayer-text')).toContainText('Dios te salve');await context.setOffline(false);
  await page.goto('/intercesor/alta/#clave=test');await page.goto('/intercesor/recuperar/');
  const paths=await page.evaluate(async()=>{const paths:string[]=[];for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())paths.push(new URL(req.url).pathname);return paths;});
  expect(paths.some(path=>/^\/(intercesor|sacerdotes|admin)\//.test(path)||path.includes('/functions/'))).toBe(false);expect(paths.some(path=>path.endsWith('.woff2'))).toBe(true);
});
test('temples retain their photos, descriptions and maps',async({page})=>{
  await page.goto('/templos/');await expect(page.locator('.temple-card')).toHaveCount(4);await expect(page.getByRole('heading',{name:'Basílica de Nuestra Señora de Luján'})).toBeVisible();for(const link of await page.getByRole('link',{name:'Ver en el mapa'}).all())expect(await link.getAttribute('href')).toMatch(/^https:\/\/www\.google\.com\/maps\/search\//);
});
