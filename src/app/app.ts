import { Component, signal, inject } from '@angular/core';
import { RouterModule, RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterModule, Header],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('flashcard');
  private auth = inject(Auth);
  protected readonly user = signal<User | null>(null);

constructor() {
  onAuthStateChanged(this.auth, (u) => {
    this.user.set(u);
  });
}
}
