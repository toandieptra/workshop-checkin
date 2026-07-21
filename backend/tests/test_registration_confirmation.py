import asyncio
import unittest
import uuid
from unittest.mock import AsyncMock, patch

from app.models import Guest
from app.services.registration_confirmation import apply_registration_policy, confirm_registration


class RegistrationConfirmationTests(unittest.TestCase):
    def test_pending_registration_does_not_enqueue_zns(self):
        guest = Guest(full_name="Khach", registration_status="confirmed")
        enqueue = AsyncMock()

        with patch("app.services.registration_confirmation.enqueue_registration", enqueue):
            changed = asyncio.run(apply_registration_policy(None, guest, auto_confirm=False))

        self.assertFalse(changed)
        self.assertEqual(guest.registration_status, "pending")
        self.assertIsNone(guest.confirmed_at)
        enqueue.assert_not_awaited()

    def test_confirmation_enqueues_zns_only_on_first_transition(self):
        guest = Guest(full_name="Khach", registration_status="pending")
        user_id = uuid.uuid4()
        enqueue = AsyncMock()

        with patch("app.services.registration_confirmation.enqueue_registration", enqueue):
            first = asyncio.run(confirm_registration(None, guest, confirmed_by=user_id))
            second = asyncio.run(confirm_registration(None, guest, confirmed_by=user_id))

        self.assertTrue(first)
        self.assertFalse(second)
        self.assertEqual(guest.registration_status, "confirmed")
        self.assertIsNotNone(guest.confirmed_at)
        self.assertEqual(guest.confirmed_by, user_id)
        enqueue.assert_awaited_once()
