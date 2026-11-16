from faithformbench_reader import text


def test_numbers_are_read_as_written_once():
    assert text.numbers("12 × 1.38 = $16.56") == {"12", "1.38", "16.56"}
    assert text.numbers("0.50 and 007 and 3.0") == {"0.5", "7", "3"}


def test_numbers_glued_to_names_are_ignored():
    assert text.numbers("(h0 : x2 = 5) (h1 : R = 54)") == {"5", "54"}
    assert text.numbers("3x + 2 = 51") == {"2", "51"}


def test_last_number():
    assert text.last_number("T = 85 + 17 = 101.") == "101"
    assert text.last_number("no numbers here") is None


def test_split_declaration():
    lean = "theorem t (x : ℕ) :\n  x = x := by\n  rfl"
    statement, proof = text.split_declaration(lean)
    assert statement == "theorem t (x : ℕ) :\n  x = x"
    assert proof.strip() == "rfl"
    assert text.split_declaration("-- Failed to formalize") is None
    assert text.split_declaration("theorem t : True") is None
    assert text.split_declaration(None) is None


def test_statement_from_formaliser_output_takes_the_last_theorem():
    output = (
        "reasoning ```lean4\ntheorem draft : 1 = 1 := by sorry\n``` more "
        "```lean4\nimport Mathlib\n\ntheorem final (n : ℕ) : n + 0 = n := by sorry\n```"
    )
    assert text.statement_from_formaliser_output(output) == "theorem final (n : ℕ) : n + 0 = n"
    assert text.statement_from_formaliser_output("no code") is None


def test_normalise_statement_ignores_name_comments_and_spacing():
    a = "theorem my_favorite_theorem (x : ℝ) :\n  x = 2 -- the answer\n"
    b = "theorem other_name (x : ℝ) : x = 2"
    assert text.normalise_statement(a) == text.normalise_statement(b)


def test_comments_do_not_count_as_statement_numbers():
    statement = "theorem t :\n  let p : ℚ := 3/5  -- 60% (interpreting 1.6 as 3/5)\n  p = 3/5"
    assert text.numbers(text.strip_comments(statement)) == {"3", "5"}


def test_proof_through_false_signal():
    assert text.proof_goes_through_false("\n  have h : False := by omega\n  exact h.elim")
    assert text.proof_goes_through_false("\n  exfalso\n  linarith")
    assert not text.proof_goes_through_false("\n  norm_num")
    assert not text.proof_goes_through_false(None)
