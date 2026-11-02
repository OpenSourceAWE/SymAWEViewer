# Writes v3_psm_sim.arrow, the flight behind test/fixtures/v3_psm_sim.arrow, to the folder named by
# ARGS[1]. Run with the examples environment of a V3Kite checkout active. It was run at
# OpenSourceAWE/V3Kite.jl@fd73944; scripts/v3_fixture_document.mjs then rewrites its document.
using V3Kite
using V3Kite: init, step!

v3kite_root = pkgdir(V3Kite)
include(joinpath(v3kite_root, "examples", "winch_adapter.jl"))

const SIM_TIME = 3.0     # [s]
const DT = 0.05          # [s] one logged frame per step
const V_WIND = 9.51      # [m/s] ground wind speed
const TETHER_LENGTH = 150.0  # [m]
const DEPOWER = 0.25     # [-]
const STEERING_AMPLITUDE = 0.1  # [-] relative steering of the one sine over the run

set_data_path(v3_data_path())
kite = init(V_WIND, TETHER_LENGTH; depower_setpoint = DEPOWER, sim_time = SIM_TIME, dt = DT,
    system_yaml = "system_psm.yaml")
kite.sys.winches[1].brake = true
set_length = kite.sys_state.l_tether[1]
controller = winch_pos_controller(kite)
for step in 1:kite.steps
    steering = STEERING_AMPLITUDE * sin(2π * step / kite.steps)
    step!(kite; rel_depower = DEPOWER, rel_steering = steering,
        set_torque = winch_torque!(controller, kite, set_length), vsm_interval = 1)
end
out = ARGS[1]
mkpath(out)
save_log(kite.logger, kite.sam.sys_struct, "v3_psm_sim"; path = out)
log_path = joinpath(out, "v3_psm_sim.arrow")
println("wrote ", log_path, " ", filesize(log_path), " bytes")
