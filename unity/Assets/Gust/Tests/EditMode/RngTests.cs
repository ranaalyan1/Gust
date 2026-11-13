using Gust.Core;
using NUnit.Framework;

namespace Gust.Tests
{
    /// <summary>
    /// Parity tests. Every expected value below was produced by running the
    /// TypeScript implementation (<c>src/core/random.ts</c>) — not by observing
    /// this C# port. If one of these fails, the port has drifted from the
    /// original and worlds will no longer match between the two builds.
    ///
    /// Golden values were generated with:
    ///   npx vite-node -e "..."  (see docs/NATIVE_QUEST_PLAN.md §4)
    /// </summary>
    public class RngTests
    {
        [Test]
        public void Mulberry32_MatchesTypeScript_ForSeed0()
        {
            var rng = new Rng(0);
            double[] expected =
            {
                0.26642920868471265,
                0.0003297457005828619,
                0.2232720274478197,
                0.1462021479383111,
                0.46732782293111086,
            };
            AssertSequence(rng, expected);
        }

        [Test]
        public void Mulberry32_MatchesTypeScript_ForSeed1()
        {
            var rng = new Rng(1);
            double[] expected =
            {
                0.6270739405881613,
                0.002735721180215478,
                0.5274470399599522,
                0.9810509674716741,
                0.9683778982143849,
            };
            AssertSequence(rng, expected);
        }

        [Test]
        public void Mulberry32_MatchesTypeScript_ForSeed12345()
        {
            var rng = new Rng(12345);
            double[] expected =
            {
                0.9797282677609473,
                0.3067522644996643,
                0.484205421525985,
                0.817934412509203,
                0.5094283693470061,
            };
            AssertSequence(rng, expected);
        }

        [Test]
        public void Mulberry32_MatchesTypeScript_ForSeed424242()
        {
            var rng = new Rng(424242);
            double[] expected =
            {
                0.1287079993635416,
                0.23631658218801022,
                0.18376533640548587,
                0.64380112150684,
                0.34235460963100195,
            };
            AssertSequence(rng, expected);
        }

        [Test]
        public void SameSeed_SameSequence_AcrossInstances()
        {
            var a = new Rng(987654);
            var b = new Rng(987654);
            for (int i = 0; i < 100; i++)
            {
                Assert.AreEqual(a.Next(), b.Next(), 0.0, $"diverged at sample {i}");
            }
        }

        [Test]
        public void Values_StayInUnitInterval()
        {
            var rng = new Rng(-777);
            for (int i = 0; i < 10000; i++)
            {
                double v = rng.Next();
                Assert.GreaterOrEqual(v, 0.0);
                Assert.Less(v, 1.0);
            }
        }

        [Test]
        public void Hash01_MatchesTypeScript()
        {
            var inputs = new[] { 0, 1, 2, 7, 42, 1000, -5 };
            var expected = new[]
            {
                0.7682745561469346,
                0.6638511982746422,
                0.9787220687139779,
                0.272106746211648,
                0.8713457323610783,
                0.3640799643471837,
                0.7606202196329832,
            };

            for (int i = 0; i < inputs.Length; i++)
            {
                Assert.AreEqual(expected[i], Hashing.Hash01(inputs[i]), 0.0,
                    $"hash01({inputs[i]})");
            }
        }

        [Test]
        public void HashString_MatchesTypeScript()
        {
            Assert.AreEqual(1356619534u, Hashing.HashString("gust"));
            Assert.AreEqual(2385417230u, Hashing.HashString("GUST"));
            Assert.AreEqual(2166136261u, Hashing.HashString("")); // FNV offset basis
            Assert.AreEqual(1793888160u, Hashing.HashString("island-3"));
        }

        [Test]
        public void Range_RewrapsNext()
        {
            var rng = new Rng(3);
            for (int i = 0; i < 1000; i++)
            {
                double v = rng.Range(2.0, 5.0);
                Assert.GreaterOrEqual(v, 2.0);
                Assert.Less(v, 5.0);
            }
        }

        private static void AssertSequence(Rng rng, double[] expected)
        {
            for (int i = 0; i < expected.Length; i++)
            {
                // 0 tolerance: these must be bit-identical, not merely close.
                Assert.AreEqual(expected[i], rng.Next(), 0.0, $"sample {i}");
            }
        }
    }
}
