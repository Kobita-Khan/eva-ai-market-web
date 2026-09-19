(function(){
  var stage=document.querySelector('[data-eva-hanging-stage]');
  if(!stage) return;

  var svg=stage.querySelector('.eva-hanging-svg');
  var cfg=[
    {xp:.14,rest:112,mass:1.00,k:.060,damping:.915,scrollForce:.75,sway:.060},
    {xp:.38,rest:152,mass:1.26,k:.049,damping:.920,scrollForce:.91,sway:.076},
    {xp:.62,rest:132,mass:1.10,k:.055,damping:.918,scrollForce:.83,sway:.068},
    {xp:.86,rest:172,mass:1.34,k:.046,damping:.922,scrollForce:1.00,sway:.082}
  ];

  var W=390,H=385,active=null,lastY=window.scrollY,lastT=performance.now();
  var scrollVelocity=0,filteredVelocity=0;
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var nodes=cfg.map(function(c,i){
    return {
      xp:c.xp,rest:c.rest,mass:c.mass,k:c.k,damping:c.damping,scrollForce:c.scrollForce,sway:c.sway,
      anchorX:0,anchorY:21,dx:0,dy:0,vx:0,vy:0,dragging:false,offX:0,offY:0,
      el:stage.querySelector('[data-index="'+i+'"]'),
      path:stage.querySelector('#evaHangingPath'+i)
    };
  });

  function layout(){
    var rect=stage.getBoundingClientRect();
    W=rect.width||390;
    H=rect.height||385;
    svg.setAttribute('viewBox','0 0 '+W+' '+H);
    nodes.forEach(function(n){n.anchorX=W*n.xp;});
  }

  function pointer(e){
    var p=(e.touches&&e.touches.length)?e.touches[0]:e;
    return {x:p.clientX,y:p.clientY};
  }

  function baseY(n){return n.anchorY+n.rest;}

  function startDrag(e,index){
    if(reduced) return;
    e.preventDefault();
    var n=nodes[index],p=pointer(e),rect=stage.getBoundingClientRect();
    var cx=n.anchorX+n.dx,cy=baseY(n)+n.dy;
    n.offX=(p.x-rect.left)-cx;
    n.offY=(p.y-rect.top)-cy;
    n.dragging=true;
    active=n;
  }

  function moveDrag(e){
    if(!active) return;
    e.preventDefault();
    var p=pointer(e),rect=stage.getBoundingClientRect();
    var tx=(p.x-rect.left)-active.offX;
    var ty=(p.y-rect.top)-active.offY;
    tx=Math.max(34,Math.min(W-34,tx));
    ty=Math.max(48,Math.min(H-34,ty));
    var ndx=tx-active.anchorX;
    var ndy=ty-baseY(active);
    active.vx=(ndx-active.dx)*.58;
    active.vy=(ndy-active.dy)*.58;
    active.dx=ndx;
    active.dy=ndy;
  }

  function endDrag(){
    if(!active) return;
    active.dragging=false;
    active=null;
  }

  nodes.forEach(function(n,i){
    if(!n.el) return;
    n.el.addEventListener('mousedown',function(e){startDrag(e,i);});
    n.el.addEventListener('touchstart',function(e){startDrag(e,i);},{passive:false});
  });
  window.addEventListener('mousemove',moveDrag);
  window.addEventListener('touchmove',moveDrag,{passive:false});
  window.addEventListener('mouseup',endDrag);
  window.addEventListener('touchend',endDrag);
  window.addEventListener('touchcancel',endDrag);

  window.addEventListener('scroll',function(){
    if(reduced) return;
    var now=performance.now(),y=window.scrollY;
    var dy=y-lastY,dt=Math.max(8,now-lastT);
    var frameVelocity=(dy/dt)*16.67;
    scrollVelocity=Math.max(-42,Math.min(42,frameVelocity));
    lastY=y;lastT=now;
  },{passive:true});

  function draw(n){
    var endX=n.anchorX+n.dx,endY=baseY(n)+n.dy;
    n.el.style.transform='translate3d('+n.dx+'px,'+n.dy+'px,0)';
    var midX=(n.anchorX+endX)/2+n.vx*1.65;
    var midY=(n.anchorY+endY)/2+Math.abs(n.vy)*.28;
    n.path.setAttribute('d','M '+n.anchorX+','+n.anchorY+' Q '+midX+','+midY+' '+endX+','+endY);
  }

  function frame(){
    if(!reduced){
      filteredVelocity+=(scrollVelocity-filteredVelocity)*.28;
      scrollVelocity*=.84;
      nodes.forEach(function(n,i){
        if(!n.dragging){
          var springX=-n.k*n.dx;
          var springY=-n.k*n.dy;
          var fy=filteredVelocity*n.scrollForce;
          var fx=filteredVelocity*n.sway*Math.sin((i+1)*1.72);
          n.vx=(n.vx+(springX+fx)/n.mass)*n.damping;
          n.vy=(n.vy+(springY+fy)/n.mass)*n.damping;
          n.dx+=n.vx;n.dy+=n.vy;

          var minDy=-(n.rest-34),maxDy=Math.min(165,H-baseY(n)-36);
          if(n.dy<minDy){n.dy=minDy;n.vy*=-.26;}
          if(n.dy>maxDy){n.dy=maxDy;n.vy*=-.30;}

          var maxDx=Math.min(62,W*.14);
          if(n.dx<-maxDx){n.dx=-maxDx;n.vx*=-.28;}
          if(n.dx>maxDx){n.dx=maxDx;n.vx*=-.28;}
        }
        draw(n);
      });
    }else{
      nodes.forEach(draw);
    }
    requestAnimationFrame(frame);
  }

  try{
    layout();
    stage.classList.add('is-physics');
    nodes.forEach(draw);
    frame();
    window.addEventListener('resize',layout);
    if(!reduced){
      setTimeout(function(){
        [-1.8,1.4,-1.1,1.7].forEach(function(v,i){
          nodes[i].vx+=v;
          nodes[i].vy+=4.5+i*.8;
        });
      },280);
    }
  }catch(err){
    stage.classList.remove('is-physics');
  }
})();