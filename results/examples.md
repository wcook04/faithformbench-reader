# Examples

False positives in which the number introduced by the perturbation does not occur in
the formal statement. The rows were sampled with a fixed seed from those whose step and
statement are short; none was hand-picked. Regenerate with
`python -m faithformbench_reader examples`.

## gsm8k-221 step_3, kimina, LLM-perturbed

- Unperturbed step: Compute daily walking distance: 3 miles (to work) + 3 miles (back) = 6 miles per workday.
- Perturbed step: Compute daily walking distance: 3 miles (to work) + 3 miles (back) = 5 miles per workday.
- Number introduced: 5

```lean
theorem my_favorite_theorem : 3 * 2 = 6
```

## olympiadbench-844 step_11, herald, LLM-perturbed

- Unperturbed step: Units digit of 17^23 equals units digit of 7^23; since 23 mod 4 = 3, it equals units digit of 7^3, hence is 3.
- Perturbed step: Units digit of 17^23 equals units digit of 7^23; since 23 mod 4 = 1, it equals units digit of 7^1, hence is 7.
- Number introduced: 1

```lean
theorem unitsDigit_17_23 :
    (17 ^ 23) % 10 = (7 ^ 23) % 10
```

## olympiadbench-937 step_15, goedel, LLM-perturbed

- Unperturbed step: Compare the two attainable values of x+y: max{15/4, 0} = 15/4, hence the maximum value of x+y is 15/4.
- Perturbed step: Compare the two attainable values of x+y: max{15/4, 0} = 15/4, hence the maximum value of x+y is 13/4.
- Number introduced: 13

```lean
theorem my_favorite_thm : 
  ∃ (x y : ℝ), 
    (∃ (r : ℝ), r ≠ 0 ∧ x = r ∧ y = r^2) ∧  -- (1, x, y) is geometric with ratio r ≠ 0
    (2 * y = x + 3) ∧  -- (x, y, 3) is arithmetic
    (max (x + y) 0 = 15/4) ∧  -- The maximum value of x+y is 15/4
    (x + y = 15/4 ∨ x + y = 0)  -- The two possible values of x+y
```

## olympiadbench-917 step_11, kimina, LLM-perturbed

- Unperturbed step: Number of outcomes with C = 1 is 5·5·1 = 25.
- Perturbed step: Number of outcomes with C = 1 is 5·4·1 = 25.
- Number introduced: 4

```lean
theorem favorite_theorem : ((Finset.range 5).filter fun x => x * (x - 1) = 0).card = 2
```

## math-921 step_12, herald, LLM-perturbed

- Unperturbed step: Compute 81 + 19 = 100, yielding 100 = 100; hence x=2 satisfies the original equation.
- Perturbed step: Compute 81 + 19 = 101, yielding 101 = 100; hence x=2 satisfies the original equation.
- Number introduced: 101

```lean
theorem my_favorite_theorem_2022  (x : ℕ)
  (h₀ : 0 < x)
  (h₁ : 3^(2 * x) + 19 = 10^x) :
  3^(2 * x) + 19 = 10^x
```

## math-536 step_2, kimina, LLM-perturbed

- Unperturbed step: 4^2 = 16.
- Perturbed step: 4^2 = 15.
- Number introduced: 15

```lean
theorem my_favorite_theorem : (4 : ℤ)^2 = 16
```

## gsm8k-297 step_5, kimina, regex-perturbed

- Unperturbed step: A week has 7 days.
- Perturbed step: A week has 5 days.
- Number introduced: 5

```lean
theorem my_favorite_theorem (total_money total_branches : ℝ) (h1 : total_money = 105) (h2 : total_branches = total_money / 0.25) : total_branches = 420
```

## math-580 step_7, goedel, regex-perturbed

- Unperturbed step: gcd(12, 13) = 1 (i.e., 12 and 13 are coprime).
- Perturbed step: gcd(12, 13) = 1 (i.e., 12 and 11 are coprime).
- Number introduced: 11

```lean
theorem my_favorite_thetical (N : ℕ) 
  (h1 : N ≡ 1 [MOD 12]) 
  (h2 : N ≡ 1 [MOD 13]) : 
  Nat.gcd 12 13 = 1
```

## omnimath-899 step_13, stepfun, regex-perturbed

- Unperturbed step: Solve 10x(x-12)=0 to get x=0 or x=12.
- Perturbed step: Solve 10x(x*12)=0 to get x=0 or x=8.
- Number introduced: 8

```lean
theorem my_favorite_theorem (x : ℝ) : 10 * x * (x - 12) = 0 ↔ x = 0 ∨ x = 12
```

## olympiadbench-839 step_4, herald, regex-perturbed

- Unperturbed step: Original box volume: 8×10×12 = 960.
- Perturbed step: Original box volume: 8×10×12 = 1261.
- Number introduced: 1261

```lean
theorem volume_of_trimmed_box_from_all_faces_excluding_one_unit_from_each_face_minus_2_units_from_each_dimension_in_the_box_with_dimensions_8_10_12 : 6 * 8 * 10 = 480
```

## gsm8k-248 step_10, herald, regex-perturbed

- Unperturbed step: The number of math problems left to complete on Thursday is 39.
- Perturbed step: The number of math problems left to complete on Thursday is 52.
- Number introduced: 52

```lean
theorem math_problems_remaining_on_Thursday : 100 - 12 - 36 - 13 = 39
```

## gsm8k-218 step_11, kimina, regex-perturbed

- Unperturbed step: Therefore, Tom traveled 3140 km in total during the two-week trip.
- Perturbed step: Therefore, Tom traveled 3246 km in total during the two/week trip.
- Number introduced: 3246

```lean
theorem my_favorite_theorem : 800 + 240 + 0 + 2100 = 3140
```
