const $ = (s) => document.querySelector(s);
let portalConfig = { pricePerPdf: 150, currency: 'INR', razorpayKeyId: '' };
$('#year').textContent = new Date().getFullYear();
fetch('/api/config').then(r=>r.json()).then(c=>{portalConfig=c; $('.price').innerHTML=`₹${c.pricePerPdf}<span> / PDF</span>`; $('.price-total b').textContent=`₹${Number(c.pricePerPdf).toFixed(2)}`;}).catch(()=>{});
$('#menuBtn').addEventListener('click',()=>document.querySelector('.topbar nav').classList.toggle('open'));
document.querySelectorAll('.topbar nav a').forEach(a=>a.addEventListener('click',()=>document.querySelector('.topbar nav').classList.remove('open')));
const fileInput=$('#pdfFile'), dropZone=$('#dropZone');
$('#browseBtn').addEventListener('click',e=>{e.preventDefault();fileInput.click()});
dropZone.addEventListener('click',e=>{if(e.target.id!=='browseBtn')fileInput.click()});
fileInput.addEventListener('change',()=>{const f=fileInput.files[0];$('#fileLabel').textContent=f?f.name:'Choose a PDF or drag it here';});
['dragenter','dragover'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.add('drag')}));
['dragleave','drop'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.remove('drag')}));
dropZone.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f){const dt=new DataTransfer();dt.items.add(f);fileInput.files=dt.files;fileInput.dispatchEvent(new Event('change'));}});
function message(el,text,ok=false){el.textContent=text;el.className='message'+(ok?' success':'');}
$('#requestForm').addEventListener('submit',async e=>{
  e.preventDefault(); const form=e.currentTarget, btn=$('#submitBtn'), msg=$('#formMessage'), file=fileInput.files[0];
  if(!file||file.type!=='application/pdf'){message(msg,'Please choose a PDF document.');return;}
  if(file.size>15*1024*1024){message(msg,'Your PDF must be smaller than 15 MB.');return;}
  if(typeof Razorpay==='undefined'){message(msg,'Payment checkout could not load. Please refresh and try again.');return;}
  btn.disabled=true;btn.textContent='Uploading securely…';message(msg,'');
  try{
    const data=new FormData(form);const response=await fetch('/api/requests',{method:'POST',body:data});const order=await response.json();if(!response.ok)throw new Error(order.error||'Could not create request.');
    const checkout=new Razorpay({key:order.keyId,amount:order.amount,currency:order.currency,name:'GG ASSOCIATES',description:`PDF correction · ${order.requestId}`,order_id:order.orderId,prefill:{name:order.name,email:order.email,contact:order.phone},theme:{color:'#101f3b'},modal:{ondismiss:()=>{btn.disabled=false;btn.innerHTML='Continue to payment <span>→</span>';message(msg,`Payment window closed. Your request ID is ${order.requestId}. You can retry by contacting us.`);}},handler:async payment=>{
      btn.textContent='Verifying payment…';
      try{const vr=await fetch('/api/payments/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payment,requestId:order.requestId})});const result=await vr.json();if(!vr.ok)throw new Error(result.error||'Verification pending.');$('#successRequestId').textContent=order.requestId;$('#successText').textContent='Your payment has been verified and your PDF correction request is now in our queue.';$('#successModal').classList.add('show');form.reset();$('#fileLabel').textContent='Choose a PDF or drag it here';}
      catch(err){message(msg,`${err.message} Please save your request ID: ${order.requestId}`);}
      finally{btn.disabled=false;btn.innerHTML='Continue to payment <span>→</span>';}
    }});
    checkout.on('payment.failed',failure=>{message(msg,`Payment was not completed: ${failure.error?.description||'Please try again.'} Your request ID is ${order.requestId}.`);btn.disabled=false;btn.innerHTML='Continue to payment <span>→</span>';});checkout.open();
  }catch(err){message(msg,err.message);btn.disabled=false;btn.innerHTML='Continue to payment <span>→</span>';}
});
$('#closeModal').addEventListener('click',()=>$('#successModal').classList.remove('show'));
$('#successModal').addEventListener('click',e=>{if(e.target.id==='successModal')$('#successModal').classList.remove('show')});
$('#trackForm').addEventListener('submit',async e=>{e.preventDefault();const d=new FormData(e.currentTarget),id=d.get('requestId').trim(),phone=d.get('phone').trim(),msg=$('#trackMessage'),out=$('#trackResult');out.innerHTML='';message(msg,'Checking…',true);try{const r=await fetch(`/api/track/${encodeURIComponent(id)}?phone=${encodeURIComponent(phone)}`);const data=await r.json();if(!r.ok)throw new Error(data.error);message(msg,'Request found.',true);out.className='track-result';out.innerHTML=`<b>${data.requestId}</b><br>Payment: <span class="status-pill">${data.paymentStatus}</span><br>Work status: <span class="status-pill">${data.workStatus}</span>${data.correctedFile?.url?`<br><a class="text-link" style="color:#9b7a43" href="${data.correctedFile.url}" target="_blank" rel="noopener">Download corrected PDF ↗</a>`:''}${data.adminNote?`<br><small>Note: ${escapeHtml(data.adminNote)}</small>`:''}`;}catch(err){message(msg,err.message);}});
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
