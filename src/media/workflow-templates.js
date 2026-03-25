// v130: Workflow Templates — ComfyUI workflow generation + validation
// ══════════════════════════════════════════════════════════════════════════════

// ── Default parameters per type ──────────────────────────────────────────────

const DEFAULTS = {
  txt2img: {
    width: 1024, height: 1024, steps: 20, cfg_scale: 7.0,
    seed: -1, sampler: 'euler', scheduler: 'normal', denoise: 1.0,
    model: '', // filled from ComfyUI available checkpoints
  },
  img2img: {
    width: 1024, height: 1024, steps: 20, cfg_scale: 7.0,
    seed: -1, sampler: 'euler', scheduler: 'normal', denoise: 0.7,
    model: '', input_image: '',
  },
  txt2vid: {
    width: 848, height: 480, steps: 30, cfg_scale: 6.0,
    seed: -1, sampler: 'euler', scheduler: 'normal', denoise: 1.0,
    model: '', frames: 49,
  },
};

// ── Workflow templates ───────────────────────────────────────────────────────

const WORKFLOW_TEMPLATES = {
  // Standard txt2img: CheckpointLoader → CLIP → KSampler → VAEDecode → SaveImage
  txt2img: {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: '{{model}}' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '{{prompt}}', clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '{{negative_prompt}}', clip: ['1', 1] },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed: '{{seed}}',
        steps: '{{steps}}',
        cfg: '{{cfg_scale}}',
        sampler_name: '{{sampler}}',
        scheduler: '{{scheduler}}',
        denoise: '{{denoise}}',
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: 'c3_gen' },
    },
  },

  // img2img: LoadImage → VAEEncode → KSampler(denoise<1) → VAEDecode → SaveImage
  img2img: {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: '{{model}}' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '{{prompt}}', clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '{{negative_prompt}}', clip: ['1', 1] },
    },
    '4': {
      class_type: 'LoadImage',
      inputs: { image: '{{input_image}}' },
    },
    '5': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['4', 0], vae: ['1', 2] },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['5', 0],
        seed: '{{seed}}',
        steps: '{{steps}}',
        cfg: '{{cfg_scale}}',
        sampler_name: '{{sampler}}',
        scheduler: '{{scheduler}}',
        denoise: '{{denoise}}',
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['1', 2] },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: { images: ['7', 0], filename_prefix: 'c3_img2img' },
    },
  },

  // txt2vid: Generic video pipeline — uses SaveAnimatedWEBP as output
  // User can replace model with HunyuanVideo, Wan, etc.
  txt2vid: {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: '{{model}}' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '{{prompt}}', clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '{{negative_prompt}}', clip: ['1', 1] },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: '{{width}}', height: '{{height}}', batch_size: '{{frames}}' },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed: '{{seed}}',
        steps: '{{steps}}',
        cfg: '{{cfg_scale}}',
        sampler_name: '{{sampler}}',
        scheduler: '{{scheduler}}',
        denoise: '{{denoise}}',
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveAnimatedWEBP',
      inputs: { images: ['6', 0], filename_prefix: 'c3_vid', fps: 12, lossless: false, quality: 85, method: 'default' },
    },
  },
};

// ── Prompt sanitization ──────────────────────────────────────────────────────

export function sanitizePrompt(p) {
  if (!p || typeof p !== 'string') return '';
  return p
    .replace(/[<>]/g, '')             // XSS prevention
    .replace(/\.\.\//g, '')           // path traversal
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')  // control chars (keep \n \r \t)
    .trim()
    .slice(0, 2000);                  // hard limit
}

// ── Param validation ─────────────────────────────────────────────────────────

export function validateParams(type, params) {
  const errors = [];
  const p = params || {};

  // Width/height: 64–4096, divisible by 8
  if (p.width !== undefined) {
    if (typeof p.width !== 'number' || p.width < 64 || p.width > 4096) {
      errors.push('width must be 64–4096');
    } else if (p.width % 8 !== 0) {
      errors.push('width must be divisible by 8');
    }
  }
  if (p.height !== undefined) {
    if (typeof p.height !== 'number' || p.height < 64 || p.height > 4096) {
      errors.push('height must be 64–4096');
    } else if (p.height % 8 !== 0) {
      errors.push('height must be divisible by 8');
    }
  }

  // Steps: 1–150
  if (p.steps !== undefined) {
    if (typeof p.steps !== 'number' || p.steps < 1 || p.steps > 150) {
      errors.push('steps must be 1–150');
    }
  }

  // CFG: 0–30
  if (p.cfg_scale !== undefined) {
    if (typeof p.cfg_scale !== 'number' || p.cfg_scale < 0 || p.cfg_scale > 30) {
      errors.push('cfg_scale must be 0–30');
    }
  }

  // Seed: -1 (random) or >= 0
  if (p.seed !== undefined) {
    if (typeof p.seed !== 'number' || (p.seed < -1)) {
      errors.push('seed must be -1 (random) or >= 0');
    }
  }

  // Denoise: 0–1
  if (p.denoise !== undefined) {
    if (typeof p.denoise !== 'number' || p.denoise < 0 || p.denoise > 1) {
      errors.push('denoise must be 0–1');
    }
  }

  // Frames (video): 1–300
  if (type === 'txt2vid' && p.frames !== undefined) {
    if (typeof p.frames !== 'number' || p.frames < 1 || p.frames > 300) {
      errors.push('frames must be 1–300');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Template retrieval (deep copy) ──────────────────────────────────────────

export function getTemplate(type) {
  const tmpl = WORKFLOW_TEMPLATES[type];
  if (!tmpl) throw new Error(`Unknown workflow type: ${type}`);
  return JSON.parse(JSON.stringify(tmpl));
}

// ── Default params ──────────────────────────────────────────────────────────

export function getDefaultParams(type) {
  const d = DEFAULTS[type];
  if (!d) throw new Error(`Unknown type: ${type}`);
  return { ...d };
}

// ── Param substitution ──────────────────────────────────────────────────────

export function substituteParams(template, params) {
  const str = JSON.stringify(template);

  const result = str.replace(/"\{\{(\w+)\}\}"/g, (match, key) => {
    const val = params[key];
    if (val === undefined) return match;  // leave unresolved

    // Random seed
    if (key === 'seed' && val === -1) {
      return String(Math.floor(Math.random() * 2 ** 32));
    }

    // Numeric values → no quotes
    if (typeof val === 'number') return String(val);

    // String values → quoted
    return JSON.stringify(String(val));
  });

  return JSON.parse(result);
}

// ── Workflow structure validation ─────────────────────────────────────────────

export function validateWorkflow(wf) {
  if (!wf || typeof wf !== 'object' || Array.isArray(wf)) {
    throw new Error('Invalid workflow: not an object');
  }

  const nodeIds = Object.keys(wf);
  if (nodeIds.length === 0) {
    throw new Error('Invalid workflow: no nodes');
  }

  for (const id of nodeIds) {
    const node = wf[id];
    if (!node || typeof node !== 'object') {
      throw new Error(`Node ${id}: not an object`);
    }
    if (!node.class_type || typeof node.class_type !== 'string') {
      throw new Error(`Node ${id}: missing class_type`);
    }
  }
}
