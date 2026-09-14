import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './contact.component.html',
  styleUrls: ['./contact.component.scss']
})
export class ContactComponent {
  // Replace this address before production if your public support mailbox differs.
  readonly contactEmail = 'hello@safepdfhub.com';

  name = '';
  email = '';
  subject = '';
  message = '';

  sendEmail(): void {
    const body = [
      `Name: ${this.name.trim() || 'Not provided'}`,
      `Email: ${this.email.trim() || 'Not provided'}`,
      '',
      this.message.trim()
    ].join('\n');

    const subject = this.subject.trim() || 'SafePDFHub contact';
    window.location.href =
      `mailto:${this.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
}
