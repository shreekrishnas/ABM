// The tracking snippet for the seller's website:
//   <script src="https://<this app>/api/v1/track/script" async></script>
// First-party only: a random visitor id in localStorage, the page URL and title, and the
// ?abm= token from tracked links. No cookies from other sites, no personal data.
export function GET(req: Request) {
  const endpoint = new URL("/api/v1/track", req.url).toString();
  const js = `(function(){try{
var E=${JSON.stringify(endpoint)},K="abm_vid",T="abm_tok",s=window.localStorage,v=s.getItem(K);
if(!v){v=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now()).replace(/[^A-Za-z0-9]/g,"").slice(0,32);s.setItem(K,v)}
var q=new URLSearchParams(location.search).get("abm");if(q){s.setItem(T,q)}var tok=s.getItem(T)||undefined,t0=Date.now();
function send(d){var b=JSON.stringify({url:location.href.split("#")[0],title:document.title.slice(0,200),referrer:document.referrer||undefined,visitorId:v,token:tok,durationSec:d});
if(navigator.sendBeacon){navigator.sendBeacon(E,b)}else{fetch(E,{method:"POST",body:b,keepalive:true,mode:"cors"})}}
send();document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden"){var d=Math.round((Date.now()-t0)/1000);if(d>=10)send(d)}});
}catch(e){}})();`;
  return new Response(js, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
