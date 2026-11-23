import { DataType } from "apache-arrow";
import { canopyPositions, type Run } from "./topology";

/** One number per frame of a run, ready to plot. */
export interface Quantity {
  /** Unique within a run: the column, then the element where the column has several. */
  id: string;
  /** The column, or derived quantity, this belongs to. */
  column: string;
  label: string;
  unit: string;
  /** One value per frame, in `unit`. */
  values: Float64Array;
  /** An angle that wraps at ±180°, so a jump in it is not a change in it. */
  periodic: boolean;
}

interface ColumnSpec {
  /** The column's names across KiteUtils versions; the first is the quantity's id. */
  names: string[];
  label: string;
  unit: string;
  /** Factor from the column's unit to `unit`. */
  scale?: number;
  periodic?: boolean;
  /** Names of a vector's elements; an element is otherwise named by its number. */
  elements?: string[];
}

const DEGREES = 180 / Math.PI;
const XYZ = ["x", "y", "z"];

function angle(label: string, names: string | string[], periodic = false): ColumnSpec {
  return { names: [names].flat(), label, unit: "deg", scale: DEGREES, periodic };
}

function rate(label: string, name: string, elements?: string[]): ColumnSpec {
  return { names: [name], label, unit: "deg/s", scale: DEGREES, elements };
}

function plain(label: string, name: string, unit: string, elements?: string[]): ColumnSpec {
  return { names: [name], label, unit, elements };
}

/** What `sysstate.yaml` says each plottable column of a run holds. */
const COLUMNS: ColumnSpec[] = [
  plain("winch force", "winch_force", "N"),
  plain("apparent wind", "v_app", "m/s"),
  angle("AoA", ["AoA", "AoAs"]),
  angle("heading", ["heading", "headings"], true),
  angle("course", ["course", "courses"], true),
  plain("tether length", "l_tether", "m"),
  plain("depower", "depower", "-"),
  plain("steering", "steering", "-"),
  plain("reel-out speed", "v_reelout", "m/s"),
  angle("elevation", ["elevation", "elevations"]),
  angle("azimuth", ["azimuth", "azimuths"]),
  rate("azimuth rate", "azimuth_rate"),
  rate("heading rate", "heading_rate"),
  angle("bearing", "bearing", true),
  angle("side slip", "side_slip"),
  plain("kite speed", "vel_kite", "m/s", XYZ),
  plain("kite acceleration", "acc", "m/s²"),
  plain("wind at the kite", "v_wind_kite", "m/s", XYZ),
  plain("wind at the ground", "v_wind_gnd", "m/s", XYZ),
  plain("wind at 200 m", "v_wind_200m", "m/s", XYZ),
  rate("turn rate", "turn_rates", XYZ),
  plain("aero force KA x", "aero_force_KA_x", "N"),
  plain("aero force KA y", "aero_force_KA_y", "N"),
  plain("aero force KA z", "aero_force_KA_z", "N"),
  plain("aero moment KA x", "aero_moment_KA_x", "N·m"),
  plain("aero moment KA y", "aero_moment_KA_y", "N·m"),
  plain("aero moment KA z", "aero_moment_KA_z", "N·m"),
  angle("twist", "twist_angles"),
  angle("flap", "flap_angle"),
  plain("pulley length", "pulley_len", "m"),
  plain("pulley speed", "pulley_vel", "m/s"),
  plain("winch torque setting", "set_torque", "N·m"),
  plain("winch speed setting", "set_speed", "m/s"),
  plain("winch force setting", "set_force", "N"),
  plain("steering setting", "set_steering", "-"),
  plain("steering at the KCU", "kcu_steering", "-"),
  plain("CL logged", "CL2", "-"),
  plain("CD logged", "CD2", "-"),
  angle("alpha3", "alpha3"),
  angle("alpha4", "alpha4"),
  plain("mechanical energy", "e_mech", "Wh"),
];

const PANEL_COLUMNS = [
  ["winch_force"],
  ["v_app"],
  ["AoA"],
  ["heading", "course"],
  ["l_tether"],
  ["depower", "steering"],
];

/** Air density the aero coefficients are referred to [kg/m³], ISA at sea level. */
const AIR_DENSITY = 1.225;

/** Each row of list column `name` as an array, or undefined without the column. */
function listRows(run: Run, name: string): ArrayLike<number>[] | undefined {
  const column = run.table.getChild(name);
  if (!column || !DataType.isList(column.type)) return undefined;
  return Array.from({ length: run.table.numRows }, (_, frame) => column.get(frame).toArray());
}

/** The series column `name` holds: one for a scalar, one per element for a list. */
function columnSeries(run: Run, name: string): Float64Array[] {
  const column = run.table.getChild(name);
  if (!column) return [];
  const frames = run.table.numRows;
  const rows = listRows(run, name);
  if (!rows) return [Float64Array.from({ length: frames }, (_, i) => Number(column.get(i)))];
  return Array.from({ length: rows[0].length }, (_, element) =>
    Float64Array.from(rows, (row) => row[element]),
  );
}

function fromColumn(run: Run, spec: ColumnSpec): Quantity[] {
  const name = spec.names.find((candidate) => run.table.getChild(candidate));
  if (!name) return [];
  const series = columnSeries(run, name);
  const scale = spec.scale ?? 1;
  return series.map((values, element) => {
    const suffix = series.length > 1 ? (spec.elements?.[element] ?? `${element + 1}`) : "";
    return {
      id: suffix ? `${spec.names[0]}/${suffix}` : spec.names[0],
      column: spec.names[0],
      label: suffix ? `${spec.label} ${suffix}` : spec.label,
      unit: spec.unit,
      values: values.map((value) => value * scale),
      periodic: spec.periodic ?? false,
    };
  });
}

/** The generic `var_NN` columns, each under the name its column metadata gives it. */
function genericVariables(run: Run): Quantity[] {
  return run.table.schema.fields
    .filter((field) => /^var_\d+$/.test(field.name))
    .flatMap((field) =>
      columnSeries(run, field.name).map((values) => ({
        id: field.name,
        column: field.name,
        label: field.metadata.get("name") ?? field.name,
        unit: "-",
        values,
        periodic: false,
      })),
    );
}

/**
 * Roll, pitch and yaw [rad] of a kite whose KA orientation is the quaternion
 * `w, x, y, z`: as KiteUtils' `euler_KS`, measured against NED with z-y-x angles.
 */
export function kiteAttitude(w: number, x: number, y: number, z: number) {
  return {
    roll: Math.atan2(-2 * (y * z + w * x), 1 - 2 * (x * x + y * y)),
    pitch: Math.asin(Math.max(-1, Math.min(1, -2 * (x * z - w * y)))),
    yaw: Math.atan2(-(1 - 2 * (y * y + z * z)), -2 * (x * y + w * z)),
  };
}

function derived(id: string, label: string, unit: string, values: Float64Array, periodic = false) {
  return { id, column: id, label, unit, values, periodic };
}

/** A reader of the kite's quaternion per frame, its first orientation slot, if it has one. */
function quaternionRows(run: Run) {
  const [w, x, y, z] = ["Qw", "Qx", "Qy", "Qz"].map((name) => listRows(run, name));
  if (!w || !x || !y || !z || w[0].length === 0) return undefined;
  return (i: number) => [w[i][0], x[i][0], y[i][0], z[i][0]] as const;
}

function attitudeQuantities(run: Run): Quantity[] {
  const quaternion = quaternionRows(run);
  if (!quaternion) return [];
  const frames = run.table.numRows;
  const attitudes = Array.from({ length: frames }, (_, i) => kiteAttitude(...quaternion(i)));
  const inDegrees = (angleOf: (attitude: (typeof attitudes)[number]) => number) =>
    Float64Array.from(attitudes, (attitude) => angleOf(attitude) * DEGREES);
  return [
    derived("roll", "roll", "deg", inDegrees((attitude) => attitude.roll), true),
    derived("pitch", "pitch", "deg", inDegrees((attitude) => attitude.pitch)),
    derived("yaw", "yaw", "deg", inDegrees((attitude) => attitude.yaw), true),
  ];
}

/** Twice the area vector of the triangle at offset `i` of flat `corners`. */
function triangleNormal(corners: Float32Array, i: number): number[] {
  const edge = (corner: number) =>
    [0, 1, 2].map((axis) => corners[i + corner * 3 + axis] - corners[i + axis]);
  const [ax, ay, az] = edge(1);
  const [bx, by, bz] = edge(2);
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/** Canopy area in the first frame, projected along the kite's KA z axis [m²]; 0 without one. */
function projectedCanopyArea(run: Run): number {
  const corners = canopyPositions(run, run.frames[0]);
  const quaternion = quaternionRows(run);
  if (corners.length === 0 || !quaternion) return 0;
  const [w, x, y, z] = quaternion(0);
  const up = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
  let area = 0;
  for (let i = 0; i < corners.length; i += 9) {
    const normal = triangleNormal(corners, i);
    area += Math.abs(normal[0] * up[0] + normal[1] * up[1] + normal[2] * up[2]) / 2;
  }
  return area;
}

/** The sum over its slots of each row. */
function summed(rows: ArrayLike<number>[]): Float64Array {
  return Float64Array.from(rows, (row) => {
    let sum = 0;
    for (let i = 0; i < row.length; i++) sum += row[i];
    return sum;
  });
}

/** Lift and drag against the apparent wind, L/D, and CL and CD where a canopy gives an area. */
function aeroQuantities(run: Run): Quantity[] {
  const forces = ["aero_force_x", "aero_force_y", "aero_force_z"].map((name) =>
    listRows(run, name),
  );
  const wind = listRows(run, "v_wind_kite");
  const velocity = listRows(run, "vel_kite");
  if (forces.includes(undefined) || !wind || !velocity) return [];
  const [fx, fy, fz] = forces.map((rows) => summed(rows!));

  const frames = run.table.numRows;
  const lift = new Float64Array(frames);
  const drag = new Float64Array(frames);
  const pressure = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const apparent = [0, 1, 2].map((axis) => wind[i][axis] - velocity[i][axis]);
    const speed = Math.hypot(...apparent);
    drag[i] = (fx[i] * apparent[0] + fy[i] * apparent[1] + fz[i] * apparent[2]) / speed;
    lift[i] = Math.sqrt(Math.max(0, fx[i] ** 2 + fy[i] ** 2 + fz[i] ** 2 - drag[i] ** 2));
    pressure[i] = 0.5 * AIR_DENSITY * speed * speed;
  }
  const quantities = [
    derived("lift", "lift", "N", lift),
    derived("drag", "drag", "N", drag),
    derived("lift_over_drag", "L/D", "-", lift.map((value, i) => value / drag[i])),
  ];
  const area = projectedCanopyArea(run);
  if (area === 0) return quantities;
  return [
    ...quantities,
    derived("CL", "CL (estimate)", "-", lift.map((value, i) => value / (pressure[i] * area))),
    derived("CD", "CD (estimate)", "-", drag.map((value, i) => value / (pressure[i] * area))),
  ];
}

/**
 * Everything of `run` that can be plotted over time, in degrees where it is an angle:
 * the columns a default panel opens on, and any other holding a value besides zero and NaN.
 */
export function runQuantities(run: Run): Quantity[] {
  const quantities = [
    ...COLUMNS.flatMap((spec) => fromColumn(run, spec)),
    ...attitudeQuantities(run),
    ...aeroQuantities(run),
    ...genericVariables(run),
  ];
  const kept = new Set(PANEL_COLUMNS.flat());
  for (const { column, values } of quantities) {
    if (values.some((value) => value !== 0 && !Number.isNaN(value))) kept.add(column);
  }
  return quantities.filter(({ column }) => kept.has(column));
}

/** The panels a run opens on, each a list of quantity ids sharing an axis; empty ones dropped. */
export function defaultPanels(quantities: Quantity[]): string[][] {
  return PANEL_COLUMNS.map((columns) =>
    quantities.filter(({ column }) => columns.includes(column)).map(({ id }) => id),
  ).filter((panel) => panel.length > 0);
}

/** The time of each frame [s], or the frame numbers for a run with no `time` column. */
export function runTimes(run: Run): Float64Array {
  const [times] = columnSeries(run, "time");
  return times ?? Float64Array.from(run.frames, (_, frame) => frame);
}

/** The frame whose time is nearest `time`, in ascending `times`. */
export function nearestFrame(times: Float64Array, time: number): number {
  let low = 0;
  let high = times.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (times[middle] <= time) low = middle;
    else high = middle;
  }
  return time - times[low] <= times[high] - time ? low : high;
}
