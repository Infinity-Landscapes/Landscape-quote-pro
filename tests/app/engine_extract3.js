const ru = (n) => Math.ceil((n||0) - 1e-9);                 // Excel ROUNDUP(x,0)
const sum = (arr) => arr.reduce((a,b)=>a+(Number(b)||0),0);
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
const PAVING_STYLES = ["Egyptian Limestone","Indian Sandstone grey (mixed)","Porcelain Wavy Edge","Standard Porcelain 900x600","Riven buff 450x450"];
const GRAVEL_STYLES = ["Cotswold Chippings","Local Shingle","Scottish Cobbles"];
const BLOCK_STYLES  = ["Brett trio block paving","Permeable block paving","Slimset block paving","Standard block paving"];
const FENCE_STYLES  = ["Custom slatted","Close board","Lap panels with wooden posts","Lap Panels with Concrete posts and gravel boards"];
const WALL_SKIN_STYLES = ["Concrete blocks","Concrete hollows","Blue engineering bricks","Red brick","Bekstone"];
const WALL_BRICKS_PER_M2 = {"Concrete blocks":10,"Concrete hollows":10,"Blue engineering bricks":60,"Red brick":60,"Bekstone":1};
const PERGOLA_POSTS = ["200x200mm treated timber post","150x150mm treated timber post","200x200mm oak post","150x150mm oak post"];
const DECK_TYPES = ["Composite Budget","Composite Standard","Composite Premium","Timber"];
const SERVICES = {

paving: { label:"Paving", group:"Hard landscaping", unitLabel:"Area", cols:["desc","width","length"],
  colLabels:["Description","Width (m)","Length (m)"],
  options:[
    {key:"style",label:"Paving style",type:"select",options:PAVING_STYLES,default:PAVING_STYLES[3]},
    {key:"covers",label:"Recessed manhole covers?",type:"yesno",default:false},
    {key:"coverCount",label:"Number of covers",type:"number",default:1,showIf:"covers"},
    {key:"productivity",label:"Productivity (m²/day)",type:"number",default:20,hint:"How much your crew lays per day — override for this job if the ground or access is different."},
  ],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.width*r.length));
    const edgeSum = sum(rows.map(r=>Number(r.width)||0)) + sum(rows.map(r=>Number(r.length)||0));
    const days = ru(area/(Number(opt.productivity)||20));
    const mats = [
      ["Geotextile membrane", area],
      ["Type 1 MOT", ru(area/5)],
      ["Sharp sand", ru(area/10)],
      ["Cement", ru(area*6/10)],
      ["SBR primer", ru(area/20)],
      [opt.style, area],
      ["Jointing compound", ru(area/10)],
      ["Edging", ru(5*edgeSum)],
      ["Brick acid", area>0?1:0],
      ["Recessed manhole cover", opt.covers? (Number(opt.coverCount)||0):0],
      ["Consumables", area>0?1:0],
    ];
    const plant = [["Plate Compactor",1,days],["Cement Mixer",1,days]];
    return {area, days, materials:mats, plant, keyFigures:[["Total area",area.toFixed(2)+" m²"],["Days required",days]]};
  }},

gravel: { label:"Gravel areas & paths", group:"Hard landscaping", unitLabel:"Area", cols:["desc","width","length"],
  colLabels:["Description","Width (m)","Length (m)"],
  options:[
    {key:"style",label:"Gravel style",type:"select",options:GRAVEL_STYLES,default:GRAVEL_STYLES[2]},
    {key:"productivity",label:"Productivity (m²/day)",type:"number",default:50,hint:"How much your crew lays per day — override for this job if needed."},
  ],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.width*r.length));
    const edgeSum = sum(rows.map(r=>Number(r.width)||0)) + sum(rows.map(r=>Number(r.length)||0));
    const days = ru(area/(Number(opt.productivity)||50));
    const mats = [
      ["Geotextile membrane", 2*area],
      ["Type 1 MOT", ru(area/5)],
      [opt.style, ru(area/10)],
      ["Edging for gravel", edgeSum],
      ["Consumables", area>0?1:0],
    ];
    const plant = [["Plate Compactor",1,days],["Welder",1,days]];
    return {area, days, materials:mats, plant, keyFigures:[["Total area",area.toFixed(2)+" m²"],["Days required",days]]};
  }},

fencing: { label:"Fencing", group:"Hard landscaping", unitLabel:"Length", cols:["desc","length"],
  colLabels:["Description","Length (m)"],
  options:[
    {key:"style",label:"Fence style",type:"select",options:FENCE_STYLES,default:FENCE_STYLES[0]},
    {key:"removeOld",label:"Remove old fence?",type:"yesno",default:false},
    {key:"gate",label:"Gate?",type:"yesno",default:false},
    {key:"gateCount",label:"Number of gates",type:"number",default:1,showIf:"gate"},
    {key:"productivity",label:"Productivity (m/day)",type:"number",default:20,hint:"How much fence line your crew installs per day — override for this job if needed."},
  ],
  calc(rows, opt, ctx){
    const len = sum(rows.map(r=>Number(r.length)||0));
    const days = ru(len/(Number(opt.productivity)||20));
    const si = FENCE_STYLES.indexOf(opt.style); // 0..3
    const post = len===0?0:[ru(len/4.8)*2+1, 1, ru(len/1.8)+1, 0][si];
    const sleeve = len===0?0:[post, ru(len/3)+1, post, 0][si];
    const concretePost = [0,0,0, ru(len/1.8)+1][si];
    const postcrete = len===0?0:[post*2, ru(len/3)*2+2, post*2, concretePost*2][si];
    const batten = [ru(len/2.4)*28, 0, 0, 0][si];
    const nails = len===0?0:[1, ru(len/50), 0, 0][si];
    const cbKit = [0, ru(len/3), 0, 0][si];
    const lapPanel = [0, 0, ru(len/1.8), ru(len/1.8)][si];
    const screws = [0, 0, ru(len/20), 0][si];
    const gravelBoard = [0,0,0, ru(len/1.8)][si];
    const mats = [
      ["100x100 treated timber fence post", post],
      ["Post saver sleeve", sleeve],
      ["Postcrete", postcrete],
      ["Treated timber batten", batten],
      ["Box of nails", nails],
      ["Close board kit 3m", cbKit],
      ["Lap panel", lapPanel],
      ["Box of 5x80mm screws", screws],
      ["Concrete fence post", concretePost],
      ["Concrete gravel board", gravelBoard],
      ["Remove old fence", opt.removeOld? len:0],
      ["Gate", opt.gate? (Number(opt.gateCount)||0):0],
      ["Consumables", len>0?1:0],
    ];
    const plant = [["Nail gun",1,days],["Breaker",1,days]];
    return {area:len, days, materials:mats, plant, keyFigures:[["Total length",len.toFixed(2)+" m"],["Days required",days]]};
  }},

metalbeds: { label:"Metal edged flower beds", group:"Planting & beds", unitLabel:"Area", cols:["desc","width","length"],
  colLabels:["Description","Width (m)","Length (m)"],
  options:[{key:"productivity",label:"Productivity (m²/day)",type:"number",default:30,hint:"How much your crew gets through per day — override for this job if needed."}],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.width*r.length));
    const edge = sum(rows.map(r=>Number(r.width)||0)) + sum(rows.map(r=>Number(r.length)||0));
    const days = ru(area/(Number(opt.productivity)||30));
    const edging = ru(edge/6)*2;
    const mats = [
      ["Metal edging", edging],
      ["Rebar", edging],
      ["Multi purpose peat free compost", ru(area/5)],
      ["Consumables", area>0?1:0],
    ];
    const plant = [["Welder",1,days,'days'], ["Grab hire", ru(area/35), null, 'flat']];
    return {area, days, materials:mats, plant, keyFigures:[["Total area",area.toFixed(2)+" m²"],["Edge length",edge.toFixed(2)+" m"]]};
  }},

sleeperbeds: { label:"Sleeper raised beds", group:"Planting & beds", unitLabel:"Area", cols:["desc","width","length"],
  colLabels:["Description","Width (m)","Length (m)"],
  options:[{key:"productivity",label:"Productivity (m²/day)",type:"number",default:30,hint:"How much your crew gets through per day — override for this job if needed."}],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.width*r.length));
    const edge = sum(rows.map(r=>Number(r.width)||0)) + sum(rows.map(r=>Number(r.length)||0));
    const days = ru(area/(Number(opt.productivity)||30));
    const sleepers = ru(edge/2.4)*2;
    const mats = [
      ["Sleeper", sleepers],
      ["Blended loam topsoil", ru(area/5)],
      ["Multi purpose peat free compost", ru(area/5)],
      ["100x100 treated timber fence post", ru(sleepers/2)],
      ["Blackjack DPM", ru(sleepers/8)],
      ["Box of 150mm hex head timber screws", ru(sleepers/8)],
      ["Consumables", area>0?1:0],
    ];
    return {area, days, materials:mats, plant:[], keyFigures:[["Total area",area.toFixed(2)+" m²"],["Edge length",edge.toFixed(2)+" m"]]};
  }},

turf: { label:"Turf", group:"Planting & beds", unitLabel:"Area", cols:["desc","width","length"],
  colLabels:["Description","Width (m)","Length (m)"],
  options:[{key:"productivity",label:"Productivity (m²/day)",type:"number",default:50,hint:"How much your crew lays per day — override for this job if needed."}],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.width*r.length));
    const days = ru(area/(Number(opt.productivity)||50));
    const mats = [
      ["Blended loam topsoil", ru(area/10)],
      ["Turf", ru(area*1.1)],
      ["Consumables", area>0?1:0],
    ];
    return {area, days, materials:mats, plant:[], keyFigures:[["Total area",area.toFixed(2)+" m²"],["Days required",days]]};
  }},

blockpaving: { label:"Block paving", group:"Hard landscaping", unitLabel:"Area", cols:["desc","width","length"],
  colLabels:["Description","Width (m)","Length (m)"],
  options:[
    {key:"style",label:"Block style",type:"select",options:BLOCK_STYLES,default:BLOCK_STYLES[3]},
    {key:"productivity",label:"Productivity (m²/day)",type:"number",default:15,hint:"How much your crew lays per day — override for this job if needed."},
  ],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.width*r.length));
    const edge = sum(rows.map(r=>Number(r.width)||0)) + sum(rows.map(r=>Number(r.length)||0));
    const days = ru(area/(Number(opt.productivity)||15));
    const mats = [
      ["Geotextile membrane", area],
      ["Type 1 MOT", ru(area*3/10)],
      ["Sharp sand", ru(edge/10)],
      ["Cement", ru(area*6/10)],
      ["Limestone 2-6mm", ru(area/10)],
      [opt.style, area],
      ["Projoint Polysweep compound", ru(area/8)],
      ["Edging blocks", ru(20*edge)],
      ["Consumables", area>0?1:0],
    ];
    const plant = [["Plate Compactor",1,days],["Cement Mixer",1,days]];
    return {area, days, materials:mats, plant, keyFigures:[["Total area",area.toFixed(2)+" m²"],["Edge length",edge.toFixed(2)+" m"]]};
  }},

resinbound: { label:"Resin bound", group:"Hard landscaping", unitLabel:"Area", cols:["desc","width","length"],
  colLabels:["Description","Width (m)","Length (m)"],
  options:[{key:"productivity",label:"Productivity (m²/day)",type:"number",default:15,hint:"How much your crew lays per day — override for this job if needed."}],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.width*r.length));
    const edge = sum(rows.map(r=>Number(r.width)||0)) + sum(rows.map(r=>Number(r.length)||0));
    const days = ru(area/(Number(opt.productivity)||15));
    const prepDays = area>0 ? 2 : 0;
    const kitQty = ru(area/1.9);
    const mats = [
      ["Addagrip geofabric membrane", ru(area/50)],
      ["Type 3 MOT", ru(area*3/10)],
      ["Addagrip Terrabase grid system", ru(area/25)],
      ["Edging for resin", ru(2*edge)],
      ["Limestone 2-6mm", ru(area/10)],
      ["Addagrip anti slip glass", ru(area/30)],
      ["Addagrip Catalyst", area>0?1:0],
      ["Addagrip terrabase UV 30mm driveway kit", kitQty],
      ["Delivery – Addagrip Terrabase UV 30mm kit", ru(kitQty/10)],
      ["Consumables", area>0?1:0],
    ];
    const plant = [["Plate Compactor",1,days],["Resin mixer",1,days]];
    return {area, days, extraLabourDays:prepDays, materials:mats, plant, keyFigures:[["Total area",area.toFixed(2)+" m²"],["Prep days",prepDays]]};
  }},

artificialturf: { label:"Artificial turf", group:"Planting & beds", unitLabel:"Area", cols:["desc","width","length"],
  colLabels:["Description","Width (m)","Length (m)"],
  options:[{key:"productivity",label:"Productivity (m²/day)",type:"number",default:15,hint:"How much your crew lays per day — override for this job if needed."}],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.width*r.length));
    const edge = sum(rows.map(r=>Number(r.width)||0)) + sum(rows.map(r=>Number(r.length)||0));
    const days = ru(area/(Number(opt.productivity)||15));
    const sharpSand = ru(edge/10);
    const mats = [
      ["Type 1 MOT", ru(area/5)],
      ["Edging for artificial turf", ru(edge)],
      ["Limestone 2-6mm", ru(area/10)],
      ["Sharp sand", sharpSand],
      ["Cement", 6*sharpSand],
      ["Grass glue", ru(edge/2)],
      ["Pins", ru(area/100)],
      ["Underlay", ru(area/25)],
      ["Geotextile membrane", 2*area],
      ["Artificial turf", area],
      ["Consumables", area>0?1:0],
    ];
    const plant = [["Plate Compactor",1,days],["Cement Mixer",1,days]];
    return {area, days, materials:mats, plant, keyFigures:[["Total area",area.toFixed(2)+" m²"],["Edge length",edge.toFixed(2)+" m"]]};
  }},

concretebase: { label:"Concrete base", group:"Hard landscaping", unitLabel:"Area", cols:["desc","width","length"],
  colLabels:["Description","Width (m)","Length (m)"],
  options:[{key:"productivity",label:"Productivity (m²/day)",type:"number",default:15,hint:"How much your crew lays per day — override for this job if needed."}],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.width*r.length));
    const edge = sum(rows.map(r=>Number(r.width)||0)) + sum(rows.map(r=>Number(r.length)||0));
    const days = ru(area/(Number(opt.productivity)||15));
    const sharpSand = ru(area/10), ballast = ru(area/10);
    const mats = [
      ["Type 1 MOT", ru(area/5)],
      ["Rebar mesh", ru(area/5)],
      ["Shuttering timber", ru(edge/2.4)*2],
      ["Sharp sand", sharpSand],
      ["Ballast", ballast],
      ["Cement", 6*sharpSand + 6*ballast],
      ["Box of 5x80mm screws", area>0?1:0],
      ["Consumables", area>0?1:0],
    ];
    const plant = [["Plate Compactor",1,days],["Cement Mixer",1,days]];
    return {area, days, materials:mats, plant, keyFigures:[["Total area",area.toFixed(2)+" m²"],["Edge length",edge.toFixed(2)+" m"]]};
  }},

brickwall: { label:"Brick & block retaining wall", group:"Walls", unitLabel:"Area", cols:["desc","length","height"],
  colLabels:["Description","Length (m)","Height (m)"],
  options:[
    {key:"skins",label:"Number of skins",type:"select",options:["1","2"],default:"1"},
    {key:"skin1",label:"Skin 1 style",type:"select",options:WALL_SKIN_STYLES,default:WALL_SKIN_STYLES[0]},
    {key:"skin2",label:"Skin 2 style",type:"select",options:WALL_SKIN_STYLES,default:WALL_SKIN_STYLES[0],showIf:"skins2"},
    {key:"compost",label:"Compost needed?",type:"yesno",default:false},
    {key:"compostArea",label:"Compost area (m²)",type:"number",default:0,showIf:"compost"},
    {key:"productivity",label:"Productivity (m²/day)",type:"number",default:8,hint:"How much wall area your crew builds per day — override for this job if needed."},
  ],
  calc(rows, opt, ctx){
    const wallArea = sum(rows.map(r=>r.length*r.height));
    const wallLen = sum(rows.map(r=>Number(r.length)||0));
    const skins = Number(opt.skins)||1;
    const days = ru(wallArea/(Number(opt.productivity)||8)) + ru(wallLen/10);
    const ballast = ru(wallLen/8)*skins, sand = ru(wallArea/14)*skins;
    const skin1Qty = ru(wallArea * (WALL_BRICKS_PER_M2[opt.skin1]||0));
    const skin2Qty = skins===2 ? ru(wallArea * (WALL_BRICKS_PER_M2[opt.skin2]||0)) : 0;
    const mats = [
      ["Ballast", ballast],
      ["Building sand", sand],
      ["Cement", 6*ballast + 6*sand],
      ["Feb", ru(wallArea/10)*skins],
      [opt.skin1, skin1Qty],
    ];
    if(skins===2) mats.push([opt.skin2, skin2Qty]);
    mats.push(["Multi purpose peat free compost", opt.compost ? ru((Number(opt.compostArea)||0)/5) : 0]);
    mats.push(["Consumables", wallLen>0?1:0]);
    const plant = [["Plate Compactor",1,days],["Cement Mixer",1,days],
      ["Digger hire", wallLen>10 ? ru(wallLen/50):0, null, 'flat']];
    return {area:wallArea, days, materials:mats, plant, keyFigures:[["Wall area",wallArea.toFixed(2)+" m²"],["Wall length",wallLen.toFixed(2)+" m"]]};
  }},

sleeperwall: { label:"Sleeper retaining wall", group:"Walls", unitLabel:"Area", cols:["desc","length","height"],
  colLabels:["Description","Length (m)","Height (m)"],
  options:[{key:"productivity",label:"Productivity (m²/day)",type:"number",default:30,hint:"How much wall area your crew builds per day — override for this job if needed."}],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.length*r.height));
    const totalLen = sum(rows.map(r=>Number(r.length)||0));
    const days = ru(area/(Number(opt.productivity)||30));
    const sleepers = sum(rows.map(r=>ru((Number(r.length)||0)/2.4) * ru((Number(r.height)||0)/0.2)));
    const posts = ru(totalLen/1.2);
    const mats = [
      ["Sleeper", sleepers],
      ["100x100mm Treated timber post", posts],
      ["Postcrete", posts*2],
      ["Box of 150mm hex head timber screws", ru(sleepers/4)],
      ["Blackjack DPM", ru(area/10)],
      ["Consumables", area>0?1:0],
    ];
    return {area, days, materials:mats, plant:[], keyFigures:[["Wall area",area.toFixed(2)+" m²"],["Wall length",totalLen.toFixed(2)+" m"]]};
  }},

pond: { label:"Pond", group:"Features", unitLabel:"Area", cols:["desc","length","width"],
  colLabels:["Description","Length (m)","Width (m)"],
  options:[
    {key:"waterFeature",label:"Water feature?",type:"yesno",default:false},
    {key:"waterFeatureCount",label:"Number of water features",type:"number",default:1,showIf:"waterFeature"},
    {key:"bridge",label:"Bridge?",type:"yesno",default:false},
    {key:"productivity",label:"Productivity (m²/day)",type:"number",default:50,hint:"How much your crew gets through per day — override for this job if needed."},
  ],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.length*r.width));
    const days = ru(area/(Number(opt.productivity)||50));
    const mats = [
      ["Pond liner", area],
      ["Pump", area>0?1:0],
      ["Filter", area>0?1:0],
      ["Rocks", ru(area/5)],
      ["Water feature", opt.waterFeature ? (Number(opt.waterFeatureCount)||0):0],
      ["Bridge", opt.bridge?1:0],
      ["Consumables", area>0?1:0],
    ];
    const plant = [["Digger hire", ru(area/5), null, 'flat']];
    return {area, days, materials:mats, plant, keyFigures:[["Total area",area.toFixed(2)+" m²"]]};
  }},

pergola: { label:"Pergola", group:"Features", unitLabel:"Area", cols:["desc","length","width"],
  colLabels:["Description","Length (m)","Width (m)"],
  options:[
    {key:"post",label:"Post type",type:"select",options:PERGOLA_POSTS,default:PERGOLA_POSTS[0]},
    {key:"productivity",label:"Productivity (m²/day)",type:"number",default:50,hint:"How much your crew builds per day — override for this job if needed."},
  ],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.length*r.width));
    const sumW = sum(rows.map(r=>Number(r.width)||0));
    const sumL = sum(rows.map(r=>Number(r.length)||0));
    const days = ru(area/(Number(opt.productivity)||50));
    const isOak = /oak/i.test(opt.post);
    const joistName = isOak ? "6x2 oak joists" : "6x2 treated timber";
    const rowProd = sum(rows.map(r=>((Number(r.width)||0)/0.4) * (Number(r.length)||0)));
    const joistQty = ru(2*sumW + rowProd + sumL);
    const mats = [
      [opt.post, ru(area/9)*4],
      [joistName, joistQty],
      ["100mm hexhead timberscrews", ru(area/10)],
      ["Blackjack DPM", ru(area/30)],
      ["Consumables", area>0?1:0],
    ];
    return {area, days, materials:mats, plant:[], keyFigures:[["Total area",area.toFixed(2)+" m²"]]};
  }},

decking: { label:"Decking", group:"Hard landscaping", unitLabel:"Area", cols:["desc","width","length"],
  colLabels:["Description","Width (m)","Length (m)"],
  options:[
    {key:"type",label:"Decking type",type:"select",options:DECK_TYPES,default:DECK_TYPES[1]},
    {key:"digOut",label:"Dig out necessary?",type:"yesno",default:false},
    {key:"productivity",label:"Productivity (m²/day)",type:"number",default:8,hint:"How much decking your crew builds per day — override for this job if needed."},
  ],
  calc(rows, opt, ctx){
    const area = sum(rows.map(r=>r.width*r.length));
    const totalLen = sum(rows.map(r=>Number(r.length)||0));
    const totalWid = sum(rows.map(r=>Number(r.width)||0));
    const days = ru(area/(Number(opt.productivity)||8));
    const isTimber = opt.type==="Timber";
    const postName = isTimber ? "100x100mm Treated timber post":"Composite posts";
    const postQty = isTimber ? ru(area/2) : ru(area);
    const joistName = isTimber ? "6x2 treated timber":"Composite joists";
    const joistQty = area>0 ? ru(totalLen/0.4)*ru(totalWid/3) + 2*ru(totalLen/3) + 1 : 0;
    const boardVariant = isTimber ? "" : opt.type.replace("Composite ","");
    const boardName = isTimber ? "3.6m x 120mm treated timber deck boards" : ("Composite deck boards - "+boardVariant);
    const boardQty = area>0 ? ru(totalLen/3.6)*ru(totalWid/0.125) : 0;
    const mats = [
      [postName, postQty],
      [joistName, joistQty],
      [boardName, boardQty],
      ["Deck screws", ru(boardQty/30)],
      ["Postcrete", postQty],
      ["Geotextile membrane", area],
      ["Consumables", area>0?1:0],
    ];
    return {area, days, materials:mats, plant:[], keyFigures:[["Total area",area.toFixed(2)+" m²"],["Total length",totalLen.toFixed(2)+" m"],["Total width",totalWid.toFixed(2)+" m"]]};
  }},
};
function priceSection(key, rows, options, ctx){
  const def = SERVICES[key];
  const raw = def.calc(rows, options, ctx);
  const materials = raw.materials
    .filter(([name,qty]) => name && qty && Math.abs(qty)>1e-9)
    .map(([name,qty])=>{
      const price = ctx.price(name);
      const unit = ctx.unit(name);
      return {name, unit, qty: Math.round(qty*100)/100, price, cost: Math.round(qty*price*100)/100};
    });
  const plant = (raw.plant||[])
    .filter(([item,qty]) => qty && Math.abs(qty)>1e-9)
    .map(([item,qty,days,mode])=>{
      const rate = ctx.price(item);
      let cost;
      if(mode==='flat'){ cost = qty*rate; } else { cost = qty*(days||0)*rate; }
      return {item, qty, days: mode==='flat'?null:days, rate, cost: Math.round(cost*100)/100};
    });
  const materialsCost = sum(materials.map(m=>m.cost));
  const plantCost = sum(plant.map(p=>p.cost));
  const labourDays = raw.days || 0;
  const extraLabourDays = raw.extraLabourDays || 0;
  const labourCost = (labourDays + extraLabourDays) * ctx.labourDayRate;
  const expensesCost = labourDays * ctx.expensesPerDay;
  const costSubtotal = materialsCost + labourCost + expensesCost + plantCost;
  // the customer-facing price for this line — cost plus the business's profit margin
  const subtotal = costSubtotal * (1 + (ctx.markupPercent||0)/100);
  return {
    key, label:def.label, rows:deepClone(rows), options:deepClone(options), custom: !!def.custom,
    keyFigures: raw.keyFigures||[], area: raw.area||0, days: labourDays,
    materials, plant, materialsCost, labourCost, expensesCost, plantCost, costSubtotal, subtotal,
  };
}

const SERVICE_ORDER = ["paving","gravel","blockpaving","resinbound","concretebase","decking","fencing","brickwall","sleeperwall","metalbeds","sleeperbeds","turf","artificialturf","pond","pergola"];
const WASTE_ELIGIBLE = ["paving","gravel","turf","artificialturf","concretebase","blockpaving","resinbound"];
function calcWasteRemoval(sections, ctx, opts){
  let area = 0;
  sections.forEach(s=>{
    if(WASTE_ELIGIBLE.includes(s.key)) area += s.area;
    if(s.key==="decking" && s.options && s.options.digOut) area += s.area;
  });
  if(area<=0) return null;
  opts = opts || {};
  // Each of the three cost drivers below has its own m²/day productivity rate (Settings › Pricing,
  // or overridden for this job only) — this is the same pattern as every other service's productivity.
  const diggerProd = opts.diggerProductivity!=null ? opts.diggerProductivity : ctx.wasteDiggerProductivity;
  const grabProd = opts.grabProductivity!=null ? opts.grabProductivity : ctx.wasteGrabProductivity;
  const labourProd = opts.labourProductivity!=null ? opts.labourProductivity : ctx.wasteLabourProductivity;
  const diggerDays = ru(area/diggerProd), grabDays = ru(area/grabProd), labourDays = ru(area/labourProd);
  // Digger hire is billed in flat 5-day blocks (a week's hire), not day by day — 1-5 digger-days
  // needed costs one hire block, 6-10 costs two, and so on. Grab hire stays a true per-day rate.
  const diggerBlocks = ru(diggerDays/5);
  const diggerCost = diggerBlocks*ctx.price("Digger hire");
  const grabCost = grabDays*ctx.price("Grab hire");
  // Clearance labour is charged at the crew's day rate, same as every other section — the number
  // of days it takes is driven by its own m²/day productivity rate, not a flat currency amount.
  const labourCost = labourDays*ctx.labourDayRate;
  const expensesCost = labourDays*ctx.expensesPerDay;
  const plant = [
    {item:"Digger hire", qty:diggerBlocks, days:null, rate:ctx.price("Digger hire"), cost:Math.round(diggerCost*100)/100},
    {item:"Grab hire", qty:grabDays, days:null, rate:ctx.price("Grab hire"), cost:Math.round(grabCost*100)/100},
  ];
  const plantCost = sum(plant.map(p=>p.cost));
  const costSubtotal = labourCost + expensesCost + plantCost;
  return {
    key:"waste", label:"Waste removal & site clearance", rows:[],
    options:{diggerProductivity:diggerProd, grabProductivity:grabProd, labourProductivity:labourProd}, area,
    keyFigures:[["Combined area", area.toFixed(2)+" m²"]], days:labourDays,
    materials:[], plant, materialsCost:0, labourCost, expensesCost, plantCost, costSubtotal,
    subtotal: costSubtotal * (1 + (ctx.markupPercent||0)/100),
  };
}
function ctxFor(settings, peopleOnSite){
  const labourDayRate = (peopleOnSite||1) * (settings.dayRatePerPerson||0);
  const vatRate = settings.vatRate;
  // Some material and running-cost prices are entered VAT-inclusive (what the supplier
  // actually charged) — strip that embedded VAT back out before it feeds the quote's own
  // subtotal, so the 20% VAT charged to the customer isn't applied a second time on top
  // of VAT that's already baked into a cost figure.
  const netOf = (price, vatIncluded) => vatIncluded ? (price||0)/(1+vatRate) : (price||0);
  return {
    price:(name)=> { const m = settings.materials[name]; return m ? netOf(m.price, m.vatIncluded) : 0; },
    unit:(name)=> (settings.materials[name] ? settings.materials[name].unit : ''),
    labourDayRate, expensesPerDay: netOf(settings.expensesPerDay, settings.expensesIncludeVat), vatRate,
    markupPercent: settings.markupPercent||0,
    wasteDiggerProductivity: (settings.productivity && settings.productivity.wasteDigger!=null) ? settings.productivity.wasteDigger : 50,
    wasteGrabProductivity: (settings.productivity && settings.productivity.wasteGrab!=null) ? settings.productivity.wasteGrab : 35,
    wasteLabourProductivity: (settings.productivity && settings.productivity.wasteLabour!=null) ? settings.productivity.wasteLabour : 70,
  };
}
module.exports = { ru, sum, deepClone, SERVICES, priceSection, WASTE_ELIGIBLE, calcWasteRemoval, ctxFor };
