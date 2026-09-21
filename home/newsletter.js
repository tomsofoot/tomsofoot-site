(()=>{
 const form=document.querySelector('.newsletter-form'),status=document.getElementById('newsletter-status');
 if(!form||!status)return;
 const input=form.querySelector('input[type="email"]'),button=form.querySelector('button');
 form.noValidate=true;
 const notice=document.createElement('p');notice.className='newsletter-consent';notice.id='newsletter-consent';
 notice.append('En cliquant sur « S’inscrire », vous consentez à l’enregistrement de votre adresse e-mail pour la newsletter TomsoFoot. ');
 const link=document.createElement('a');link.href='/confidentialite.html#newsletter';link.textContent='Politique de confidentialité';notice.append(link);form.append(notice);
 input.setAttribute('aria-describedby','newsletter-consent newsletter-status');input.maxLength=254;
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled)return;
  const email=input.value.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254){status.textContent='Email invalide';input.setAttribute('aria-invalid','true');input.focus();return;}
  input.removeAttribute('aria-invalid');button.disabled=true;status.textContent='Inscription en cours…';
  try{
   const response=await fetch('/.netlify/functions/newsletter',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,consent:true}),signal:AbortSignal.timeout(15000)});
   const data=await response.json();
   if(data.status==='subscribed')status.textContent='Inscrit';
   else if(data.status==='already_subscribed')status.textContent='Déjà inscrit';
   else if(data.status==='invalid_email'){status.textContent='Email invalide';input.setAttribute('aria-invalid','true');}
   else throw Error();
  }catch{status.textContent='L’inscription est momentanément indisponible. Merci de réessayer.';}
  finally{button.disabled=false;}
 });
})();
