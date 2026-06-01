/* ==========================================================================
   DESKTOP WIRE EDM INTERACTIVE DASHBOARD - APPLICATION ENGINE (app.js)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // 1. STATE & GLOBAL CONFIGURATION
    const state = {
        isMachining: false,
        currentPath: 'square',
        material: 'aluminum',
        ton: 12,        // microseconds
        toff: 60,       // microseconds
        voltage: 60,    // volts
        current: 2.5,   // amperes
        feedrate: 0.8,  // mm/min
        progress: 0,    // percentage
        
        // Stage tracking coordinates
        x: 0.0,
        y: 0.0,
        targetPointIndex: 0,
        
        // Telemetry outputs
        frequency: 45.45,
        dutyCycle: 16.67,
        energy: 1.13,
        mrr: 0.24,
        igbtTemp: 38.4,
        
        // Active toolpath nodes list
        pathPoints: []
    };

    // Component details for Interactive Hardware Explorer
    const hardwareDatabase = {
        arduino: {
            title: "Arduino Uno R3",
            role: "CENTRAL CONTROLLER",
            desc: "The central intelligence unit of the Desktop Wire EDM. Loaded with optimized CNC interpreter firmware, it processes toolpath coordinate strings and outputs synchronized stepper step pulses alongside high-frequency PWM switching signals to the spark board.",
            spec1: "ATmega328P Core",
            spec2: "16 MHz clock rate",
            spec3: "GRBL Command Map"
        },
        sparkpcb: {
            title: "Custom Pulsed Spark PCB",
            role: "IGBT MODULATOR",
            desc: "An in-house custom switching circuit utilizing a high-current Insulated-Gate Bipolar Transistor (IGBT) and gate driver. It modulates the 60V DC reservoir line into microsecond spark bursts regulated by the Arduino's digital gate signals.",
            spec1: "FGH40N60SMD IGBT",
            spec2: "Switch limit: 150kHz",
            spec3: "Optocoupled Isolation"
        },
        power60v: {
            title: "60V DC Power Supply",
            role: "EROSION POWER RESERVOIR",
            desc: "A stable, high-voltage linear power supply designed to charge the pulse capacitor bank. It provides the heavy energy reservoir required to generate high-frequency micro-sparks capable of vaporizing tough conductive metals.",
            spec1: "60V DC Regulated",
            spec2: "3.0 Amps max load",
            spec3: "Over-current protection"
        },
        motors: {
            title: "NEMA 17 Stepper Motors",
            role: "AXIS ACTUATORS",
            desc: "High-torque stepper motors operating at a 1.8-degree step angle. Paired with micro-stepping motor drivers, they drive precision stainless steel lead screws to position the submergible X/Y stage with micron-scale accuracy.",
            spec1: "42N.cm holding torque",
            spec2: "1.8 deg step angle",
            spec3: "A4988 1/16 microsteps"
        },
        electrode: {
            title: "Brass Wire & Toolhead",
            role: "SPARK DISCHARGE GAP",
            desc: "A continuous spool of 0.25mm brass wire fed through precision parallel guides. Operating as the negative electrode, a constant tension feed ensures clean brass passes the workpiece, eroding shapes without wear-induced geometric errors.",
            spec1: "0.25mm Brass Wire",
            spec2: "0.05-0.10mm spark gap",
            spec3: "Deionized Water Coolant"
        }
    };

    // Material parameters (used in formulas)
    const materialConstants = {
        aluminum: { k: 1.2, name: "Aluminum", meltingPoint: 660, conductivity: 237 },
        steel: { k: 0.6, name: "Tool Steel", meltingPoint: 1500, conductivity: 45 },
        brass: { k: 1.0, name: "Brass", meltingPoint: 930, conductivity: 110 },
        copper: { k: 0.85, name: "Copper", meltingPoint: 1085, conductivity: 401 }
    };

    // 2. DOM ELEMENT CACHING
    const elements = {
        sliderTon: document.getElementById('slider-ton'),
        sliderToff: document.getElementById('slider-toff'),
        sliderVoltage: document.getElementById('slider-voltage'),
        sliderCurrent: document.getElementById('slider-current'),
        sliderFeedrate: document.getElementById('slider-feedrate'),
        
        valTon: document.getElementById('val-ton'),
        valToff: document.getElementById('val-toff'),
        valVoltage: document.getElementById('val-voltage'),
        valCurrent: document.getElementById('val-current'),
        valFeedrate: document.getElementById('val-feedrate'),
        
        selectToolpath: document.getElementById('select-toolpath'),
        btnStart: document.getElementById('btn-start'),
        btnReset: document.getElementById('btn-reset'),
        
        headerFreq: document.getElementById('header-frequency'),
        headerDuty: document.getElementById('header-duty'),
        
        telFreq: document.getElementById('tel-frequency'),
        telDuty: document.getElementById('tel-duty'),
        telEnergy: document.getElementById('tel-energy'),
        telMrr: document.getElementById('tel-mrr'),
        telIgbtTemp: document.getElementById('tel-igbt-temp'),
        telIgbtRow: document.getElementById('tel-igbt-temp').parentElement,
        
        telemetryCoord: document.getElementById('telemetry-coord'),
        progressText: document.getElementById('progress-text'),
        progressBar: document.getElementById('machining-progress'),
        sparkFlash: document.getElementById('spark-flash'),
        
        // Schematic components
        compCard: document.getElementById('comp-card'),
        compTitle: document.getElementById('comp-title'),
        compRole: document.getElementById('comp-role'),
        compDesc: document.getElementById('comp-desc'),
        spec1: document.getElementById('spec-1'),
        spec2: document.getElementById('spec-2'),
        spec3: document.getElementById('spec-3'),
        nodes: document.querySelectorAll('.diagram-node'),
        
        // Canvas & SVG
        canvas: document.getElementById('edm-canvas'),
        pathPwm: document.getElementById('path-pwm'),
        pathVoltage: document.getElementById('path-voltage'),
        pathCurrent: document.getElementById('path-current')
    };

    // Canvas Context Setup
    const ctx = elements.canvas.getContext('2d');
    let animationFrameId = null;

    // Spark Particles System
    let particles = [];
    
    // Wire simulation wheel rotations
    let wireSpoolRotation = 0;

    // 3. TELEMETRY & FORMULA COMPUTATIONS
    function calculateTelemetry() {
        const ton = state.ton;
        const toff = state.toff;
        const voltage = state.voltage;
        const current = state.current;
        const k = materialConstants[state.material].k;
        
        // Frequency f = 1 / (Ton + Toff) inside microseconds, converted to kHz
        state.frequency = 1000 / (ton + toff);
        
        // Duty cycle D = Ton / (Ton + Toff)
        state.dutyCycle = (ton / (ton + toff)) * 100;
        
        // Spark Energy estimation: E = 0.5 * C * V^2 (mJ) where C = 0.47 uF, scaled with current influence
        const baseCapacitance = 0.47; // microFarad
        state.energy = 0.5 * baseCapacitance * Math.pow(voltage / 10, 2) * (current / 2.5);
        
        // Material Removal Rate (MRR): Proportional to Spark Energy, Frequency and Material Thermal Constant
        state.mrr = state.energy * state.frequency * k * 0.005;
        
        // IGBT Temperature estimation based on duty cycle and switching losses (proportional to current and frequency)
        // IGBT base junction temp is 25 C. Higher frequency + higher current + higher duty cycle leads to thermal load
        const thermalResistance = 1.2; // C/W
        const conductionLosses = current * 1.4 * (state.dutyCycle / 100);
        const switchingLosses = 0.05 * current * (state.frequency / 10);
        const totalLosses = conductionLosses + switchingLosses;
        state.igbtTemp = 24.2 + (totalLosses * 15 * thermalResistance);
        
        // Update DOM Telemetry Elements
        elements.headerFreq.textContent = `${state.frequency.toFixed(2)} kHz`;
        elements.headerDuty.textContent = `${state.dutyCycle.toFixed(1)}%`;
        
        elements.telFreq.textContent = `${state.frequency.toFixed(2)} kHz`;
        elements.telDuty.textContent = `${state.dutyCycle.toFixed(2)} %`;
        elements.telEnergy.textContent = `${state.energy.toFixed(2)} mJ`;
        elements.telMrr.textContent = `${state.mrr.toFixed(4)} mm³/min`;
        elements.telIgbtTemp.textContent = `${state.igbtTemp.toFixed(1)} °C`;
        
        // Alert styling on high temperatures
        if (state.igbtTemp > 75) {
            elements.telIgbtTemp.textContent += ' (OVERHEAT WARN)';
            elements.telIgbtRow.className = 'telemetry-row highlight-row alert';
            elements.telIgbtTemp.className = 'item-value text-red';
        } else if (state.igbtTemp > 50) {
            elements.telIgbtTemp.textContent += ' (WARM)';
            elements.telIgbtRow.className = 'telemetry-row highlight-row';
            elements.telIgbtTemp.className = 'item-value text-amber';
        } else {
            elements.telIgbtTemp.textContent += ' (SAFE)';
            elements.telIgbtRow.className = 'telemetry-row highlight-row';
            elements.telIgbtTemp.className = 'item-value text-green';
        }
    }

    // 4. DIGITAL OSCILLOSCOPE SIGNAL GENERATOR (SVG Rendering)
    function renderOscilloscope() {
        const svgWidth = 500;
        const svgHeight = 200;
        
        const ton = state.ton;
        const toff = state.toff;
        const cycle = ton + toff; // total period
        
        // Map time periods to horizontal pixels (fit ~3-4 full cycles in 500px width)
        const scaleX = 500 / (cycle * 3.5); 
        
        let dPwm = '';
        let dVoltage = '';
        let dCurrent = '';
        
        let x = 0;
        let isSwitchOn = false;
        
        // Base voltage levels
        const pwmHigh = 50;  // Y-axis coordinates (SVG origin is top-left)
        const pwmLow = 90;
        const voltMax = 105;
        const voltSpark = 150;
        const voltZero = 175;
        const currMax = 115;
        const currZero = 170;
        
        while (x < svgWidth) {
            // Draw a cycle
            // 1. Pulse-Off period (Capacitor charging, switch open)
            const offWidth = toff * scaleX;
            
            // PWM is LOW
            dPwm += dPwm === '' ? `M ${x} ${pwmLow}` : ` L ${x} ${pwmLow}`;
            dPwm += ` L ${x + offWidth} ${pwmLow}`;
            
            // Gap Voltage charges exponentially up to peak
            dVoltage += dVoltage === '' ? `M ${x} ${voltZero}` : ` L ${x} ${voltZero}`;
            // Exponential charge curve
            for (let t = 0; t <= offWidth; t += 2) {
                const px = x + t;
                const ratio = t / offWidth;
                // V(t) = Vmax * (1 - e^-t)
                const val = voltZero - (voltZero - voltMax) * (1 - Math.exp(-ratio * 3));
                dVoltage += ` L ${px} ${val}`;
            }
            dVoltage += ` L ${x + offWidth} ${voltMax}`;
            
            // Current stays at ZERO
            dCurrent += dCurrent === '' ? `M ${x} ${currZero}` : ` L ${x} ${currZero}`;
            dCurrent += ` L ${x + offWidth} ${currZero}`;
            
            x += offWidth;
            if (x >= svgWidth) break;
            
            // 2. Pulse-On period (Switch closed, spark discharges)
            const onWidth = ton * scaleX;
            
            // PWM goes HIGH
            dPwm += ` L ${x} ${pwmHigh}`;
            dPwm += ` L ${x + onWidth} ${pwmHigh}`;
            
            // Gap Voltage drops rapidly to spark sustaining level, then drops to zero at pulse off
            dVoltage += ` L ${x} ${voltMax}`;
            // Spark breakdown drops from voltMax to voltSpark almost instantly (~10% of On-Time)
            const breakdownWidth = Math.min(onWidth * 0.15, 8);
            dVoltage += ` L ${x + breakdownWidth} ${voltSpark}`;
            dVoltage += ` L ${x + onWidth} ${voltSpark}`;
            dVoltage += ` L ${x + onWidth} ${voltZero}`;
            
            // Current spikes to max, holds during spark, drops to zero
            dCurrent += ` L ${x} ${currZero}`;
            dCurrent += ` L ${x + breakdownWidth} ${currMax}`;
            dCurrent += ` L ${x + onWidth} ${currMax}`;
            dCurrent += ` L ${x + onWidth} ${currZero}`;
            
            x += onWidth;
        }
        
        elements.pathPwm.setAttribute('d', dPwm);
        elements.pathVoltage.setAttribute('d', dVoltage);
        elements.pathCurrent.setAttribute('d', dCurrent);
    }

    // 5. TOOLPATH GEOMETRY GENERATOR
    function generateToolpath() {
        const points = [];
        const canvasWidth = elements.canvas.width;
        const canvasHeight = elements.canvas.height;
        
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        
        if (state.currentPath === 'square') {
            // Micro-Gear Profile: Traces circular array of teeth
            const radius = 55;
            const teeth = 8;
            const toothHeight = 12;
            const totalSteps = 120;
            
            for (let i = 0; i <= totalSteps; i++) {
                const angle = (i / totalSteps) * Math.PI * 2;
                
                // Construct a gear profile using a modulated square wave on radius
                const factor = Math.sign(Math.sin(teeth * angle));
                const currentRadius = radius + (factor > 0 ? toothHeight : 0);
                
                const px = centerX + Math.cos(angle) * currentRadius;
                const py = centerY + Math.sin(angle) * currentRadius;
                
                points.push({ x: px, y: py });
            }
        } 
        else if (state.currentPath === 'sine') {
            // Complex Waveform Spline: S-shaped curves cutting slots
            const length = 160;
            const startX = centerX - length / 2;
            const totalSteps = 100;
            
            for (let i = 0; i <= totalSteps; i++) {
                const ratio = i / totalSteps;
                const px = startX + ratio * length;
                // Wave Y coordinate using composite sine values
                const py = centerY + Math.sin(ratio * Math.PI * 2.5) * 35 + Math.cos(ratio * Math.PI * 4) * 8;
                points.push({ x: px, y: py });
            }
        } 
        else if (state.currentPath === 'grid') {
            // Orthogonal Heat-Sink Fins: Traces up-and-down deep grid slots
            const finWidth = 24;
            const finHeight = 70;
            const startX = centerX - 80;
            
            points.push({ x: startX, y: centerY - finHeight/2 });
            
            for (let i = 0; i < 4; i++) {
                const base = startX + i * finWidth * 2;
                points.push({ x: base, y: centerY + finHeight/2 });
                points.push({ x: base + finWidth, y: centerY + finHeight/2 });
                points.push({ x: base + finWidth, y: centerY - finHeight/2 });
                points.push({ x: base + finWidth * 2, y: centerY - finHeight/2 });
            }
        }
        else if (state.currentPath === 'antigravity') {
            // Precision Antigravity Logo: stylized triangular "A" outline
            const baseWidth = 120;
            const height = 90;
            const startX = centerX - baseWidth / 2;
            const startY = centerY + height / 2;
            
            // Outer triangle and inner crossbar path
            const nodes = [
                { x: startX, y: startY },
                { x: centerX, y: centerY - height/2 }, // Apex
                { x: centerX + baseWidth/2, y: startY }, // Right bottom
                
                // Move in for inner geometric cutout
                { x: centerX + baseWidth/4, y: startY - 10 },
                { x: centerX - baseWidth/4, y: startY - 10 },
                { x: centerX, y: startY - 60 },
                { x: centerX + baseWidth/4, y: startY - 10 }
            ];
            
            // Interpolate points between nodes for smooth animation steps
            for (let n = 0; n < nodes.length - 1; n++) {
                const n1 = nodes[n];
                const n2 = nodes[n+1];
                const segmentSteps = 25;
                for (let s = 0; s < segmentSteps; s++) {
                    const ratio = s / segmentSteps;
                    points.push({
                        x: n1.x + (n2.x - n1.x) * ratio,
                        y: n1.y + (n2.y - n1.y) * ratio
                    });
                }
            }
            points.push(nodes[nodes.length - 1]);
        }
        
        state.pathPoints = points;
        state.targetPointIndex = 0;
        state.progress = 0;
        
        if (points.length > 0) {
            state.x = points[0].x;
            state.y = points[0].y;
        }
    }

    // 6. CANVAS ANIMATION & SPARK ERASER ENGINE
    function resizeCanvas() {
        const rect = elements.canvas.parentElement.getBoundingClientRect();
        elements.canvas.width = rect.width;
        elements.canvas.height = rect.height;
        
        generateToolpath();
        drawChamber();
    }

    // Custom Spark Particle constructor
    function createSpark(x, y) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = 1.5 + Math.random() * 2.5;
        const size = 1 + Math.random() * 2.5;
        const maxLife = 10 + Math.random() * 20;
        
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * velocity,
            vy: Math.sin(angle) * velocity,
            size: size,
            life: maxLife,
            maxLife: maxLife,
            color: Math.random() > 0.3 ? 'var(--color-cyan)' : '#ffffff'
        });
    }

    function updateParticles() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            p.size *= 0.95; // shrink
            
            if (p.life <= 0) {
                particles.splice(i, 1);
            }
        }
    }

    function drawChamber() {
        const cw = elements.canvas.width;
        const ch = elements.canvas.height;
        
        // Clear canvas
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, cw, ch);
        
        // 1. Draw grid backdrop (coordinate grid lines)
        ctx.strokeStyle = '#121b2b';
        ctx.lineWidth = 1;
        const gridSize = 30;
        for (let x = 0; x < cw; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, ch);
            ctx.stroke();
        }
        for (let y = 0; y < ch; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(cw, y);
            ctx.stroke();
        }

        // 2. Draw workpiece block (thick metallic plate in center)
        const blockW = 200;
        const blockH = 130;
        const blockX = (cw - blockW) / 2;
        const blockY = (ch - blockH) / 2;
        
        // Metallic workpiece color profile
        ctx.save();
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 10;
        ctx.fillRect(blockX, blockY, blockW, blockH);
        ctx.strokeRect(blockX, blockY, blockW, blockH);
        ctx.restore();
        
        // 3. ERODED SLITS LAYER (Dynamic Cutout)
        // Clear or draw transparent pixels representing cutting kerf (wire thickness 0.25mm + spark gap)
        if (state.targetPointIndex > 0 && state.pathPoints.length > 0) {
            ctx.save();
            ctx.strokeStyle = '#090d16'; // background color acts as air/dielectric cavity
            ctx.lineWidth = 5; // represents width of cut
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(state.pathPoints[0].x, state.pathPoints[0].y);
            
            const limit = Math.min(state.targetPointIndex, state.pathPoints.length - 1);
            for (let i = 1; i <= limit; i++) {
                ctx.lineTo(state.pathPoints[i].x, state.pathPoints[i].y);
            }
            ctx.stroke();
            ctx.restore();
        }

        // 4. Draw targeted trajectory outline (dashed guide line)
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 243, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        if (state.pathPoints.length > 0) {
            ctx.moveTo(state.pathPoints[0].x, state.pathPoints[0].y);
            for (let i = 1; i < state.pathPoints.length; i++) {
                ctx.lineTo(state.pathPoints[i].x, state.pathPoints[i].y);
            }
        }
        ctx.stroke();
        ctx.restore();

        // 5. Draw active EDM spools (spinning gear wheels at top and bottom limits)
        ctx.save();
        const topSpoolY = 30;
        const bottomSpoolY = ch - 30;
        const spoolX = cw / 2;
        
        // Spin wheels based on spool rotation
        const angle = wireSpoolRotation;
        
        // Helper function for spool wheel
        function drawSpool(sx, sy) {
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(angle);
            ctx.fillStyle = '#1e293b';
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 2;
            
            // Circle wheel
            ctx.beginPath();
            ctx.arc(0, 0, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            // Spokes
            for (let i = 0; i < 4; i++) {
                ctx.rotate(Math.PI / 2);
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(16, 0);
                ctx.stroke();
            }
            ctx.restore();
        }
        
        drawSpool(spoolX - 110, topSpoolY);
        drawSpool(spoolX + 110, topSpoolY);
        drawSpool(spoolX - 110, bottomSpoolY);
        drawSpool(spoolX + 110, bottomSpoolY);
        ctx.restore();

        // 6. Draw vertical brass wire spool path
        ctx.save();
        ctx.strokeStyle = '#d97706'; // copper/brass color
        ctx.lineWidth = 2.0;
        ctx.shadowColor = '#d97706';
        ctx.shadowBlur = state.isMachining ? 5 : 0;
        
        ctx.beginPath();
        // Wire feeds from top, goes down past active X,Y coordinate, exits at bottom spool
        ctx.moveTo(state.x, topSpoolY);
        ctx.lineTo(state.x, bottomSpoolY);
        ctx.stroke();
        ctx.restore();

        // 7. Draw spark particles
        ctx.save();
        particles.forEach(p => {
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();

        // 8. Draw active tool nozzle head (X/Y carriage)
        ctx.save();
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(56, 189, 248, 0.4)';
        ctx.shadowBlur = 8;
        
        // Nozzle block
        ctx.beginPath();
        ctx.rect(state.x - 12, topSpoolY + 10, 24, 18);
        ctx.fill();
        ctx.stroke();
        
        // Bottom block nozzle guide
        ctx.beginPath();
        ctx.rect(state.x - 12, bottomSpoolY - 28, 24, 18);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    // 7. SIMULATOR STATE LOOP
    function loop() {
        if (!state.isMachining) return;
        
        // Continuous rotation representing wire spool movement (constant speed)
        wireSpoolRotation += 0.05;
        
        if (state.pathPoints.length > 0) {
            // Speed up calculations: feedrate determines how many interpolation steps we cover per frame
            const feedrateScale = state.feedrate * 0.4;
            state.targetPointIndex += feedrateScale;
            
            const index = Math.floor(state.targetPointIndex);
            
            if (index < state.pathPoints.length) {
                const targetPoint = state.pathPoints[index];
                
                // Slide nozzle positions
                state.x = targetPoint.x;
                state.y = targetPoint.y;
                
                // Track progress
                state.progress = (index / (state.pathPoints.length - 1)) * 100;
                
                // Update live coordinate logs
                // Map center of canvas to origin (0.00) and scale 1px to 0.1mm
                const displayX = ((state.x - elements.canvas.width / 2) * 0.1).toFixed(2);
                const displayY = (((elements.canvas.height / 2) - state.y) * 0.1).toFixed(2);
                elements.telemetryCoord.textContent = `X: ${displayX} mm | Y: ${displayY} mm`;
                
                elements.progressBar.style.width = `${state.progress}%`;
                elements.progressText.textContent = `MACHINING (${state.progress.toFixed(1)}%)`;
                
                // Trigger sparks at the erosion front
                // Sparks are produced based on the configured frequency setting
                const numSparks = Math.round(state.frequency / 10);
                for (let s = 0; s < numSparks; s++) {
                    createSpark(state.x, state.y);
                }
                
                // Subtle oscilloscope flash indicator in sync with pulse-on
                if (Math.random() < (state.dutyCycle / 100)) {
                    elements.sparkFlash.style.opacity = '0.04';
                    setTimeout(() => {
                        elements.sparkFlash.style.opacity = '0';
                    }, 30);
                }
            } else {
                // Toolpath complete!
                state.isMachining = false;
                elements.btnStart.textContent = '⚡ START EROSION';
                elements.progressText.textContent = 'COMPLETED (100%)';
                elements.progressBar.style.width = '100%';
                elements.sparkFlash.style.opacity = '0';
            }
        }
        
        updateParticles();
        drawChamber();
        
        // Keep looping
        animationFrameId = requestAnimationFrame(loop);
    }

    // 8. INTERACTIVE SCHEMATIC EVENT BINDING
    function loadHardwareCard(key) {
        const item = hardwareDatabase[key];
        if (!item) return;
        
        // Active node highlight toggle
        elements.nodes.forEach(node => {
            if (node.getAttribute('data-block') === key) {
                node.classList.add('active');
            } else {
                node.classList.remove('active');
            }
        });
        
        // Update Card text
        elements.compTitle.textContent = item.title;
        elements.compRole.textContent = item.role;
        elements.compDesc.textContent = item.desc;
        elements.spec1.textContent = item.spec1;
        elements.spec2.textContent = item.spec2;
        elements.spec3.textContent = item.spec3;
    }

    // 9. EVENT LISTENERS SETUP
    
    // Sliders input monitoring
    elements.sliderTon.addEventListener('input', (e) => {
        state.ton = parseInt(e.target.value);
        elements.valTon.textContent = `${state.ton} μs`;
        calculateTelemetry();
        renderOscilloscope();
    });

    elements.sliderToff.addEventListener('input', (e) => {
        state.toff = parseInt(e.target.value);
        elements.valToff.textContent = `${state.toff} μs`;
        calculateTelemetry();
        renderOscilloscope();
    });

    elements.sliderVoltage.addEventListener('input', (e) => {
        state.voltage = parseInt(e.target.value);
        elements.valVoltage.textContent = `${state.voltage} V`;
        calculateTelemetry();
        renderOscilloscope();
    });

    elements.sliderCurrent.addEventListener('input', (e) => {
        state.current = parseFloat(e.target.value);
        elements.valCurrent.textContent = `${state.current.toFixed(1)} A`;
        calculateTelemetry();
        renderOscilloscope();
    });

    elements.sliderFeedrate.addEventListener('input', (e) => {
        state.feedrate = parseFloat(e.target.value);
        elements.valFeedrate.textContent = `${state.feedrate.toFixed(1)} mm/min`;
    });

    // Material selector grid clicks
    document.querySelectorAll('.material-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetBtn = e.target.closest('.material-btn');
            document.querySelectorAll('.material-btn').forEach(b => b.classList.remove('active'));
            targetBtn.classList.add('active');
            
            state.material = targetBtn.getAttribute('data-material');
            calculateTelemetry();
        });
    });

    // Toolpath preset dropdown
    elements.selectToolpath.addEventListener('change', (e) => {
        state.currentPath = e.target.value;
        if (state.isMachining) {
            // Cancel active loop
            state.isMachining = false;
            cancelAnimationFrame(animationFrameId);
            elements.btnStart.textContent = '⚡ START EROSION';
        }
        generateToolpath();
        drawChamber();
    });

    // Start/Pause Button click
    elements.btnStart.addEventListener('click', () => {
        if (state.isMachining) {
            // Pause action
            state.isMachining = false;
            elements.btnStart.textContent = '⚡ RESUME EROSION';
            cancelAnimationFrame(animationFrameId);
        } else {
            // Start action
            if (state.progress >= 100) {
                // auto-reset on completion
                generateToolpath();
            }
            state.isMachining = true;
            elements.btnStart.textContent = '⏸️ PAUSE EROSION';
            loop();
        }
    });

    // Reset button click
    elements.btnReset.addEventListener('click', () => {
        state.isMachining = false;
        cancelAnimationFrame(animationFrameId);
        elements.btnStart.textContent = '⚡ START EROSION';
        elements.progressBar.style.width = '0%';
        elements.progressText.textContent = 'IDLE (0.0%)';
        particles = [];
        
        generateToolpath();
        drawChamber();
    });

    // Schematic nodes clicks
    elements.nodes.forEach(node => {
        node.addEventListener('click', () => {
            const key = node.getAttribute('data-block');
            loadHardwareCard(key);
        });
    });

    // Window size dynamic canvas correction
    window.addEventListener('resize', resizeCanvas);

    // 10. INITIALIZATION RUN
    resizeCanvas();
    calculateTelemetry();
    renderOscilloscope();
    loadHardwareCard('arduino'); // default explorer load
});
