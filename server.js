import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import "./styles.css";

const socket = io("http://localhost:5000"); // update if deployed

function App() {
  const [roomId, setRoomId] = useState(null);
  const [step, setStep] = useState("waiting"); // waiting, setNumber, guess
  const [myNumber, setMyNumber] = useState("");
  const [guess, setGuess] = useState("");
  const [log, setLog] = useState(["Connecting to server..."]);
  const [myTurn, setMyTurn] = useState(false);

  // Listen for server events
  useEffect(() => {
    socket.on("waiting", msg => setLog(prev => [...prev, { text: msg }]));

    socket.on("gameStart", ({ roomId: rId, players }) => {
      setRoomId(rId);
      setStep("setNumber");
      setLog(prev => [...prev, { text: "🎉 Game started! Set your number." }]);
    });

    socket.on("bothReady", msg => setLog(prev => [...prev, { text: msg }]));

    socket.on("guessResult", ({ player, guess, result }) => {
      setLog(prev => [
        ...prev,
        {
          text: `${player === socket.id ? "You" : "Opponent"} guessed ${guess} -> ${result.correctPosition} correct position, ${result.correctDigit} correct digit(s)`
        }
      ]);
    });

    socket.on("nextTurn", playerId => {
      const isMyTurn = playerId === socket.id;
      setMyTurn(isMyTurn);
      setLog(prev => [
        ...prev,
        {
          text: isMyTurn ? "✨ Your turn!" : "⏳ Opponent's turn...",
          highlight: isMyTurn,
        }
      ]);
    });

    socket.on("gameOver", ({ winner }) => {
      setStep("gameOver");
      setLog(prev => [
        ...prev,
        {
          text: winner === socket.id ? "🏆 You won!" : "💔 You lost!",
          highlight: true,
        }
      ]);
    });

    socket.on("opponentLeft", () => {
      setStep("waiting");
      setLog(prev => [...prev, { text: "⚠️ Opponent left the game." }]);
      setRoomId(null);
      setMyTurn(false);
    });

    return () => {
      socket.off("waiting");
      socket.off("gameStart");
      socket.off("bothReady");
      socket.off("guessResult");
      socket.off("nextTurn");
      socket.off("gameOver");
      socket.off("opponentLeft");
    };
  }, []);

  const joinGame = () => {
    socket.emit("joinGame");
  };

  const submitNumber = () => {
    if (!myNumber) return;
    socket.emit("setNumber", { roomId, number: myNumber.padStart(4, "0") });
    setStep("guess");
    setLog(prev => [...prev, { text: `✅ Your number is set: ${myNumber.padStart(4, "0")}` }]);
  };

  const submitGuess = () => {
    if (!guess || !myTurn) return;
    socket.emit("makeGuess", { roomId, guess: guess.padStart(4, "0") });
    setGuess("");
  };

  return (
    <div className="game-container">
      <h1>🎀 Number Guess Game 🎀</h1>

      <div className="log">
        {log.map((msg, index) => (
          <div
            key={index}
            className="log-item"
            style={{
              color: msg.highlight ? "#ff69b4" : "#fff",
              textShadow: msg.highlight ? "0 0 8px #ff69b4, 0 0 12px #ff69b4" : "none",
              fontWeight: msg.highlight ? "bold" : "normal",
            }}
          >
            {msg.text}
          </div>
        ))}
      </div>

      {step === "waiting" && (
        <button onClick={joinGame}>💖 Join Game 💖</button>
      )}

      {step === "setNumber" && (
        <>
          <input
            type="text"
            maxLength={4}
            placeholder="Enter your number"
            value={myNumber}
            onChange={(e) => setMyNumber(e.target.value.replace(/\D/g, ""))}
          />
          <button onClick={submitNumber}>💖 Set Number 💖</button>
        </>
      )}

      {step === "guess" && (
        <>
          <input
            type="text"
            maxLength={4}
            placeholder="Guess opponent's number"
            value={guess}
            onChange={(e) => setGuess(e.target.value.replace(/\D/g, ""))}
            disabled={!myTurn}
          />
          <button onClick={submitGuess} disabled={!myTurn}>
            💡 Submit Guess 💡
          </button>
        </>
      )}

      {step === "gameOver" && (
        <button onClick={joinGame}>🔄 Play Again 🔄</button>
      )}
    </div>
  );
}

export default App;
