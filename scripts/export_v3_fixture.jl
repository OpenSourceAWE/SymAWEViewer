# Writes v3_psm_sim.arrow to the folder ARGS[1]; run in a V3Kite examples environment.
using V3Kite
using V3Kite: init, step!

v3kite_root = pkgdir(V3Kite)
include(joinpath(v3kite_root, "examples", "winch_adapter.jl"))

sim_time = 3.0     # [s]
dt = 0.05          # [s] one logged frame per step
v_wind = 9.51      # [m/s] ground wind speed
tether_length = 150.0  # [m]
depower = 0.25     # [-]
steering_amplitude = 0.1  # [-] relative steering of the one sine over the run

set_data_path(v3_data_path())
kite = init(v_wind, tether_length; depower_setpoint = depower, sim_time, dt,
    system_yaml = "system_psm.yaml")
kite.sys.winches[1].brake = true
set_length = kite.sys_state.l_tether[1]
controller = winch_pos_controller(kite)
for step in 1:kite.steps
    steering = steering_amplitude * sin(2π * step / kite.steps)
    step!(kite; rel_depower = depower, rel_steering = steering,
        set_torque = winch_torque!(controller, kite, set_length), vsm_interval = 1)
end
out = ARGS[1]
mkpath(out)
save_log(kite.logger, kite.sam.sys_struct, "v3_psm_sim"; path = out)
log_path = joinpath(out, "v3_psm_sim.arrow")
println("wrote ", log_path, " ", filesize(log_path), " bytes")
