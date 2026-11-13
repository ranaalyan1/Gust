using Gust.Core;
using NUnit.Framework;

namespace Gust.Tests
{
    /// <summary>
    /// Tests mirroring <c>tests/stepper</c> behaviour in the TypeScript project:
    /// frame rate must not change simulation feel.
    /// </summary>
    public class FixedStepperTests
    {
        [Test]
        public void SixtyFramesAtSixtyHertz_RunsSixtySteps()
        {
            var stepper = new FixedStepper();
            int steps = 0;
            for (int i = 0; i < 60; i++)
            {
                steps += stepper.Advance(1.0 / 60.0, _ => { });
            }

            Assert.AreEqual(60, steps);
            Assert.AreEqual(60, stepper.Steps);
        }

        [Test]
        public void FrameRateDoesNotChangeSimulatedTime()
        {
            var at72 = new FixedStepper();
            at72.Advance(1.0 / 72.0, _ => { });
            for (int i = 0; i < 71; i++) at72.Advance(1.0 / 72.0, _ => { });

            var at144 = new FixedStepper();
            for (int i = 0; i < 144; i++) at144.Advance(1.0 / 144.0, _ => { });

            // One second of real time at very different frame rates.
            Assert.That(at72.Time, Is.EqualTo(144.0 / 144.0).Within(0.02));
            Assert.That(at144.Time, Is.EqualTo(144.0 / 144.0).Within(0.02));
        }

        [Test]
        public void LongHitch_IsCappedByMaxSteps()
        {
            var stepper = new FixedStepper(FixedStepper.FixedDt, 5);
            int steps = stepper.Advance(10.0, _ => { }); // a ten second stall
            Assert.LessOrEqual(steps, 5);
        }

        [Test]
        public void ZeroOrNegativeDelta_DoesNothing()
        {
            var stepper = new FixedStepper();
            Assert.AreEqual(0, stepper.Advance(0.0, _ => { }));
            Assert.AreEqual(0, stepper.Advance(-1.0, _ => { }));
            Assert.AreEqual(0, stepper.Steps);
            Assert.AreEqual(0.0, stepper.Alpha, 1e-12);
        }

        [Test]
        public void AlphaIsFractionOfStepLeftOver()
        {
            var stepper = new FixedStepper();
            stepper.Advance(FixedStepper.FixedDt * 1.5, _ => { });
            Assert.That(stepper.Alpha, Is.EqualTo(0.5).Within(1e-6));
        }

        [Test]
        public void Pending_ReportsStepsAboutToRun()
        {
            var stepper = new FixedStepper();
            Assert.AreEqual(0, stepper.Pending(0.0));
            Assert.AreEqual(1, stepper.Pending(1.0 / 60.0));
            Assert.LessOrEqual(stepper.Pending(10.0), stepper.MaxSteps);
        }

        [Test]
        public void StepReceivesFixedDt()
        {
            var stepper = new FixedStepper();
            double seen = 0;
            stepper.Advance(1.0 / 60.0, dt => seen = dt);
            Assert.AreEqual(FixedStepper.FixedDt, seen, 1e-12);
        }
    }
}
