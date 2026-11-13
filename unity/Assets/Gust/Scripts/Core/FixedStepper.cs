using System;

namespace Gust.Core
{
    /// <summary>
    /// Fixed timestep. Physics always advances in identical 1/60 s steps, so a
    /// 72 Hz, 90 Hz or stuttering frame rate changes how often we look at the
    /// simulation, never how it feels.
    ///
    /// Port of <c>src/core/stepper.ts</c>.
    /// </summary>
    public sealed class FixedStepper
    {
        public const double FixedDt = 1.0 / 60.0;

        /// <summary>Length of one simulation step (s).</summary>
        public readonly double Dt;

        /// <summary>Never simulate more than this many steps per frame.</summary>
        public readonly int MaxSteps;

        /// <summary>0..1 fraction of a step left over, for render interpolation.</summary>
        public double Alpha { get; private set; }

        /// <summary>Total fixed steps taken.</summary>
        public long Steps { get; private set; }

        private double _accumulator;

        public FixedStepper(double dt = FixedDt, int maxSteps = 5)
        {
            if (!(dt > 0)) throw new ArgumentOutOfRangeException(nameof(dt));
            if (maxSteps < 1) throw new ArgumentOutOfRangeException(nameof(maxSteps));
            Dt = dt;
            MaxSteps = maxSteps;
        }

        /// <summary>Simulated time (s).</summary>
        public double Time => Steps * Dt;

        /// <summary>
        /// How many steps <see cref="Advance"/> is about to run, so per-frame
        /// input can be spread across them.
        /// </summary>
        public int Pending(double frameDelta)
        {
            if (!(frameDelta > 0)) return 0;
            double acc = Math.Min(_accumulator + frameDelta, Dt * MaxSteps);
            return (int)Math.Floor((acc + 1e-9) / Dt);
        }

        /// <summary>
        /// Feed real elapsed time; <paramref name="step"/> is called zero or
        /// more times with the fixed dt. Returns the number of steps run.
        /// </summary>
        public int Advance(double frameDelta, Action<double> step)
        {
            if (step == null) throw new ArgumentNullException(nameof(step));
            if (!(frameDelta > 0)) return 0;

            _accumulator += frameDelta;

            double cap = Dt * MaxSteps;
            if (_accumulator > cap) _accumulator = cap; // drop time, never spiral

            int n = 0;
            // The epsilon stops 60 Hz frames alternating 0 and 2 steps on float error.
            while (_accumulator >= Dt - 1e-9)
            {
                step(Dt);
                _accumulator -= Dt;
                Steps++;
                n++;
            }

            if (_accumulator < 0) _accumulator = 0;
            Alpha = _accumulator / Dt;
            return n;
        }
    }
}
