const themeButton=document.getElementById('theme');
const systemTheme=window.matchMedia('(prefers-color-scheme: light)');
function applyTheme(mode){
  const light=mode==='light';
  document.body.classList.toggle('light',light);
  themeButton.textContent=light?'☾　切換深色':'☼　切換淺色';
}
let themeMode=systemTheme.matches?'light':'dark';
applyTheme(themeMode);
themeButton.addEventListener('click',()=>{
  themeMode=themeMode==='light'?'dark':'light';
  applyTheme(themeMode);
});
