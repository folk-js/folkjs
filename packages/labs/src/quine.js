function draw(string) /*I:10*/{ 
const lines= string.split('\n')
       /* THIS IS A   */       
       /* QUINE. ITS  */
       /* OUTPUT IS   */
       /* ITSELF.     */
       /* -ORION REED */
       const sz=0.067721
       const height = sz 
       * 1.5;const x=-.8 
       const startY = -1 
       + 0.05; lines.map
       ((lin, i)=>{const 
       y=startY+i*height
       floor(params.t*2* 
       lines.length)> i?
       text (lin,x,y,sz) 
       :"";return lin})}       
function m(){const src=`${draw}
${m} m();`; draw (src);  } m();