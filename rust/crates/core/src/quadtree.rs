//! Pooled point quadtree (`src/quadtree.js`). Items are indices into an entity
//! array; the insertion position is stored for splitting, and queries read live
//! positions through a callback exactly like the JS version reads `o.x`/`o.y`.

struct Node {
    cx: f64,
    cy: f64,
    half: f64,
    depth: u32,
    items: Vec<(u32, f64, f64)>,
    kids: Option<[usize; 4]>,
}

pub struct Quadtree {
    pub width: f64,
    pub height: f64,
    capacity: usize,
    max_depth: u32,
    pool: Vec<Node>,
    used: usize,
    pub size: usize,
    stack: Vec<usize>,
}

impl Quadtree {
    pub fn new(width: f64, height: f64) -> Quadtree {
        let mut q = Quadtree { width, height, capacity: 10, max_depth: 10, pool: Vec::new(), used: 0, size: 0, stack: Vec::new() };
        q.clear();
        q
    }

    fn node(&mut self, cx: f64, cy: f64, half: f64, depth: u32) -> usize {
        if self.used >= self.pool.len() {
            self.pool.push(Node { cx: 0.0, cy: 0.0, half: 0.0, depth: 0, items: Vec::new(), kids: None });
        }
        let id = self.used;
        self.used += 1;
        let n = &mut self.pool[id];
        n.cx = cx;
        n.cy = cy;
        n.half = half;
        n.depth = depth;
        n.items.clear();
        n.kids = None;
        id
    }

    pub fn clear(&mut self) {
        self.used = 0;
        self.size = 0;
        let (w, h) = (self.width, self.height);
        self.node(w / 2.0, h / 2.0, w.max(h) / 2.0, 0);
    }

    pub fn insert(&mut self, id: u32, x: f64, y: f64) {
        self.size += 1;
        let mut n = 0usize;
        loop {
            if let Some(kids) = self.pool[n].kids {
                let node = &self.pool[n];
                n = kids[(if x >= node.cx { 1 } else { 0 }) + (if y >= node.cy { 2 } else { 0 })];
                continue;
            }
            self.pool[n].items.push((id, x, y));
            if self.pool[n].items.len() > self.capacity && self.pool[n].depth < self.max_depth {
                self.split(n);
            }
            return;
        }
    }

    fn split(&mut self, n: usize) {
        let (cx, cy, half, depth) = {
            let node = &self.pool[n];
            (node.cx, node.cy, node.half, node.depth)
        };
        let h = half / 2.0;
        let d = depth + 1;
        let kids = [
            self.node(cx - h, cy - h, h, d),
            self.node(cx + h, cy - h, h, d),
            self.node(cx - h, cy + h, h, d),
            self.node(cx + h, cy + h, h, d),
        ];
        let items = std::mem::take(&mut self.pool[n].items);
        self.pool[n].kids = Some(kids);
        for it in items {
            let k = kids[(if it.1 >= cx { 1 } else { 0 }) + (if it.2 >= cy { 2 } else { 0 })];
            self.pool[k].items.push(it);
        }
        for k in kids {
            if self.pool[k].items.len() > self.capacity && self.pool[k].depth < self.max_depth {
                self.split(k);
            }
        }
    }

    /// Every inserted item whose *live* position (from `pos`) lies within `r`
    /// of (x, y), in the same order the JS traversal yields them.
    pub fn query(&mut self, x: f64, y: f64, r: f64, pos: &dyn Fn(u32) -> (f64, f64), out: &mut Vec<u32>) {
        let r2 = r * r;
        let mut stack = std::mem::take(&mut self.stack);
        stack.clear();
        stack.push(0);
        while let Some(n) = stack.pop() {
            let node = &self.pool[n];
            let dx = ((x - node.cx).abs() - node.half).max(0.0);
            let dy = ((y - node.cy).abs() - node.half).max(0.0);
            if dx * dx + dy * dy > r2 {
                continue;
            }
            if let Some(kids) = node.kids {
                for k in kids {
                    stack.push(k);
                }
                continue;
            }
            for it in &node.items {
                let (px, py) = pos(it.0);
                let ox = px - x;
                let oy = py - y;
                if ox * ox + oy * oy < r2 {
                    out.push(it.0);
                }
            }
        }
        self.stack = stack;
    }
}
